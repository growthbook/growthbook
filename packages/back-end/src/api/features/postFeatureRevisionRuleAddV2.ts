import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import { v4 as uuidv4 } from "uuid";
import {
  RevisionRampCreateAction,
  postFeatureRevisionRuleAddV2Validator,
  RuleCreateInput,
  RuleCreateInputV2,
  SafeRolloutInterface,
} from "shared/validators";
import type { FeatureRule, SafeRolloutRule } from "shared/validators";
import { getEffectiveRevisionHoldout, resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { ExperimentInterface } from "shared/types/experiment";
import { CreateProps } from "shared/types/base-model";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  toApiRevisionV2,
  addIdsToFlatRules,
  assertFeatureValuesValid,
} from "back-end/src/services/features";
import { assertConfigBackedFeatureValuesValid } from "back-end/src/services/configValidation";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  linkExperimentToHoldout,
  resolveHoldoutExperimentToLink,
} from "back-end/src/services/holdouts";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getRevision,
  prevalidateRevisionUpdate,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { generateId } from "back-end/src/util/uuid";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "back-end/src/util/errors";
import {
  discardIfJustCreated,
  isDraftStatus,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  resolveOrCreateRevision,
  validateRuleAttributes,
  validateRuleConditions,
  validateRuleReferences,
} from "./validations";
import { buildRuleFromInput } from "./postFeatureRevisionRuleAdd";
import {
  assertNoRawConfigExtends,
  assertValidRuleConfigKeys,
  composeConfigBacking,
  resolveScopeFromInput,
} from "./v2Shared";

export const postFeatureRevisionRuleAddV2 = createApiRequestHandler(
  postFeatureRevisionRuleAddV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { schedule } = req.body;
  const inlineRampSchedule = req.body.rampSchedule;
  const ruleInput = req.body.rule as RuleCreateInputV2;

  // Capture config-backing inputs before the experiment-ref variation backfill
  // below rewrites `ruleInput.variations` (which would otherwise drop `config`).
  // `value` is an override patch when a config is supplied; we recompose it into
  // the internal `$extends`-first value after the rule is built.
  const ruleLevelConfig =
    "config" in ruleInput
      ? (ruleInput as { config?: string | null }).config
      : undefined;
  const variationConfigs =
    ruleInput.type === "experiment-ref"
      ? ruleInput.variations.map((v) => v.config)
      : [];

  if (inlineRampSchedule && (schedule?.startDate || schedule?.endDate)) {
    throw new BadRequestError(
      "rampSchedule and schedule are mutually exclusive. Provide one or the other, not both.",
    );
  }

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: req.body.revisionTitle, comment: req.body.revisionComment },
  );

  let createdSafeRolloutId: string | undefined;
  let linkedExperimentId: string | undefined;
  let linkedHoldoutId: string | undefined;
  let holdoutExperimentToLink: ExperimentInterface | null = null;
  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    await assertValidRuleConfigKeys(
      req.context,
      [ruleLevelConfig, ...variationConfigs],
      revision.defaultValue ?? feature.defaultValue,
      feature.baseConfig,
      feature.project,
    );

    if (ruleInput.type === "experiment-ref") {
      const anyMissing = ruleInput.variations.some((v) => !v.variationId);
      const allMissing = ruleInput.variations.every((v) => !v.variationId);
      if (anyMissing && !allMissing) {
        throw new BadRequestError(
          "Either provide variationId for all variations or none; mixed inputs are not allowed.",
        );
      }
      // Legacy revisions store holdout sparsely, so absence carries the
      // feature's holdout forward.
      const effectiveHoldout = getEffectiveRevisionHoldout(revision, feature);
      const needsHoldoutCheck = Boolean(effectiveHoldout?.id);
      if (anyMissing || needsHoldoutCheck) {
        const experiment = await getExperimentById(
          req.context,
          ruleInput.experimentId,
        );
        if (!experiment)
          throw new NotFoundError(
            `Could not find experiment "${ruleInput.experimentId}"`,
          );

        if (anyMissing) {
          const phaseVariations = getLatestPhaseVariations(experiment);
          if (phaseVariations.length < ruleInput.variations.length) {
            throw new BadRequestError(
              `Experiment has ${phaseVariations.length} variation(s) but ${ruleInput.variations.length} were specified`,
            );
          }
          ruleInput.variations = ruleInput.variations.map((v, i) => ({
            variationId: phaseVariations[i].id,
            value: v.value,
          }));
        }

        if (needsHoldoutCheck) {
          // Linking writes are deferred until after custom-hook prevalidation below.
          holdoutExperimentToLink = await resolveHoldoutExperimentToLink({
            context: req.context,
            feature,
            experiment,
            effectiveHoldout,
            makeError: (message) => new BadRequestError(message),
          });
        }
      }
    }

    // V2: derive scope from the rule itself, not from a body `environment` field.
    const { allEnvironments, environments, ...baseRuleInput } =
      ruleInput as RuleCreateInputV2 & {
        allEnvironments?: boolean;
        environments?: string[];
      };
    const rule = buildRuleFromInput(baseRuleInput as RuleCreateInput, uuidv4());

    // Config backing comes only through the dedicated `config` field; a raw
    // `@config:` embedded in a value is rejected (matches mapV2ApiRuleToFeatureRule).
    if (rule.type === "force" || rule.type === "rollout") {
      assertNoRawConfigExtends(rule.value, "Rule value");
    } else if (rule.type === "experiment-ref") {
      rule.variations.forEach((v) =>
        assertNoRawConfigExtends(v.value, "Variation value"),
      );
    }

    // Recompose config-backing into the stored value(s). null detaches.
    if (
      (rule.type === "force" || rule.type === "rollout") &&
      ruleLevelConfig !== undefined
    ) {
      rule.value = composeConfigBacking(
        ruleLevelConfig,
        rule.value,
        "Rule value",
      );
    }
    if (rule.type === "experiment-ref") {
      rule.variations = rule.variations.map((rv, i) => {
        const c = variationConfigs[i];
        return c !== undefined
          ? {
              ...rv,
              value: composeConfigBacking(c, rv.value, "Variation value"),
            }
          : rv;
      });
    }

    // Backfill seed for rollout rules to ensure ramp-monitored payload
    // stability — consistent with the write-time backfill in addIdsToFlatRules.
    addIdsToFlatRules([rule as FeatureRule], feature.id);

    // Enforce the feature's JSON schema on the new rule's values (no-op for
    // config-backed values). Opt out with ?skipSchemaValidation=true.
    assertFeatureValuesValid(req.context, feature, {
      rules: [rule as FeatureRule],
    });
    // Config-backed rule values additionally validate against the backing
    // config's schema + invariants (assertFeatureValuesValid is a no-op for
    // them). Same check the publish path runs; a no-op for non-config values.
    await assertConfigBackedFeatureValuesValid(req.context, feature, {
      rules: [rule as FeatureRule],
    });

    validateRuleConditions(rule);
    // Opt-in registered-attribute check before any side effects (safe-rollout
    // create, revision update). New rules have no baseline, so this validates
    // every attribute-bearing field on the incoming rule.
    validateRuleAttributes(rule, req.context, feature.project);
    await validateRuleReferences(rule, req.context);

    // Pre-generate the safeRollout id so hooks see the rule's final shape; the doc is created after prevalidation
    let safeRolloutCreateProps: CreateProps<SafeRolloutInterface> | null = null;
    if (ruleInput.type === "safe-rollout" && rule.type === "safe-rollout") {
      if (!req.context.hasPremiumFeature("safe-rollout")) {
        req.context.throwPlanDoesNotAllowError(
          "Safe Rollout rules require an Enterprise plan.",
        );
      }

      const { rampUpSchedule, ...validatableFields } = (
        ruleInput as typeof ruleInput & {
          type: "safe-rollout";
          safeRolloutFields: Record<string, unknown>;
        }
      ).safeRolloutFields;
      const validatedFields = await validateCreateSafeRolloutFields(
        validatableFields,
        req.context,
      );

      const defaultRampSteps = [
        { percent: 0.1 },
        { percent: 0.25 },
        { percent: 0.5 },
        { percent: 0.75 },
        { percent: 1 },
      ];
      const safeRolloutId = generateId("sr_");
      safeRolloutCreateProps = {
        id: safeRolloutId,
        ...validatedFields,
        featureId: feature.id,
        status: "running",
        autoSnapshots: true,
        rampUpSchedule: {
          enabled: rampUpSchedule?.enabled ?? false,
          step: 0,
          steps: rampUpSchedule?.steps ?? defaultRampSteps,
          rampUpCompleted: false,
          nextUpdate: undefined,
        },
      };
      (rule as SafeRolloutRule).safeRolloutId = safeRolloutId;
    }

    const usesLegacyScheduling =
      ruleInput.type === "experiment-ref" || ruleInput.type === "safe-rollout";

    if (usesLegacyScheduling && inlineRampSchedule) {
      throw new BadRequestError(
        `rampSchedule is not supported for ${ruleInput.type} rules. Use "schedule" instead.`,
      );
    }

    let resolvedRampAction = inlineRampSchedule
      ? normalizeInlineRampSchedule(inlineRampSchedule, rule.id)
      : undefined;
    if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
      if (usesLegacyScheduling) {
        rule.scheduleRules = [
          { enabled: true, timestamp: schedule.startDate ?? null },
          { enabled: false, timestamp: schedule.endDate ?? null },
        ];
        rule.scheduleType = "schedule";
      } else {
        if (schedule.startDate) rule.enabled = false;
        resolvedRampAction = buildScheduleRampAction(
          rule.id,
          schedule.startDate,
          schedule.endDate,
        );
      }
    }

    // V2: stamp scope from the rule's own allEnvironments/environments fields.
    const { allEnvironments: resolvedAllEnvs, environments: resolvedEnvs } =
      resolveScopeFromInput(allEnvironments, environments);
    const baseRules = cloneDeep(revision.rules ?? []);
    const stampedRule: FeatureRule = {
      ...rule,
      allEnvironments: resolvedAllEnvs,
      environments: resolvedEnvs,
    };
    const newRules: FeatureRule[] = [...baseRules, stampedRule];

    const changes: RevisionChanges = { rules: newRules };

    if (resolvedRampAction) {
      const existing = revision.rampActions ?? [];
      const filtered = existing.filter(
        (a) =>
          !("ruleId" in a) ||
          a.ruleId !== (resolvedRampAction as RevisionRampCreateAction).ruleId,
      );
      changes.rampActions = [...filtered, resolvedRampAction];
    }

    // Compute affected envs for review reset.
    const affectedEnvs = resolvedAllEnvs
      ? Object.keys(feature.environmentSettings ?? {})
      : (environments ?? []);
    const resetReview = resetReviewOnChange({
      feature,
      changedEnvironments: affectedEnvs,
      defaultValueChanged: false,
      settings: req.organization.settings,
    });

    // Run custom hooks before the side-effect writes below so a rejection doesn't orphan them
    await prevalidateRevisionUpdate(
      req.context,
      feature,
      revision,
      changes,
      resetReview,
    );

    if (safeRolloutCreateProps) {
      const safeRollout = await req.context.models.safeRollout.create(
        safeRolloutCreateProps,
      );
      if (!safeRollout)
        throw new InternalServerError("Failed to create safe rollout");
      createdSafeRolloutId = safeRollout.id;
    }

    if (holdoutExperimentToLink && feature.holdout?.id) {
      // Record ids for compensation BEFORE the writes — the rollback is
      // idempotent, so a mid-write failure is still fully compensated.
      linkedExperimentId = holdoutExperimentToLink.id;
      linkedHoldoutId = feature.holdout.id;
      await linkExperimentToHoldout(
        req.context,
        holdoutExperimentToLink,
        feature.holdout.id,
      );
    }

    await updateRevision(
      req.context,
      feature,
      revision,
      changes,
      {
        user: req.context.auditUser,
        action: "add rule",
        subject: resolvedAllEnvs
          ? "all environments"
          : `to ${(environments ?? []).join(", ")}`,
        value: JSON.stringify(rule),
      },
      resetReview,
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "rule.add",
      {
        environments: affectedEnvs,
        auditDetails: { ruleId: rule.id, ruleType: rule.type },
      },
    );

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    if (createdSafeRolloutId) {
      try {
        await req.context.models.safeRollout.deleteById(createdSafeRolloutId);
      } catch {
        /* best effort */
      }
    }
    if (linkedExperimentId) {
      try {
        const exp = await getExperimentById(req.context, linkedExperimentId);
        if (exp)
          await updateExperiment({
            context: req.context,
            experiment: exp,
            changes: { holdoutId: "" },
          });
      } catch {
        /* best effort */
      }
    }
    if (linkedHoldoutId && linkedExperimentId) {
      try {
        const holdout =
          await req.context.models.holdout.getById(linkedHoldoutId);
        if (holdout?.linkedExperiments?.[linkedExperimentId]) {
          await req.context.models.holdout.updateById(linkedHoldoutId, {
            linkedExperiments: omit(holdout.linkedExperiments, [
              linkedExperimentId,
            ]),
          });
        }
      } catch {
        /* best effort */
      }
    }
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
