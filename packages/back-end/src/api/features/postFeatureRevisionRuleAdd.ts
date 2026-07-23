import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import { v4 as uuidv4 } from "uuid";
import {
  RevisionRampCreateAction,
  postFeatureRevisionRuleAddValidator,
  RuleCreateInput,
  SafeRolloutInterface,
} from "shared/validators";
import type {
  ExperimentRefRule,
  FeatureRule,
  ForceRule,
  RolloutRule,
  SafeRolloutRule,
} from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { ExperimentInterface } from "shared/types/experiment";
import { CreateProps } from "shared/types/base-model";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  assertFeatureValuesValid,
  toApiRevision,
} from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
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
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  resolveOrCreateRevision,
  validateRuleAttributes,
  validateRuleConditions,
  validateRuleReferences,
} from "./validations";

const SAFE_ROLLOUT_TRACKING_KEY_PREFIX = "sr-";

export function buildRuleFromInput(
  input: RuleCreateInput,
  id: string,
): FeatureRule {
  const base = {
    id,
    allEnvironments: false,
    description: input.description ?? "",
    enabled: input.enabled ?? true,
    condition: input.condition,
    savedGroups: input.savedGroups,
    prerequisites: input.prerequisites,
    scheduleRules: input.scheduleRules,
    scheduleType: input.scheduleType,
  };

  if (input.type === "experiment-ref") {
    const rule: ExperimentRefRule = {
      ...base,
      type: "experiment-ref",
      experimentId: input.experimentId,
      variations: input.variations.map((v) => ({
        variationId: v.variationId ?? "",
        value: v.value,
      })),
      ...(input.sparse !== undefined && { sparse: input.sparse }),
    };
    return rule;
  }

  if (input.type === "safe-rollout") {
    const rule: SafeRolloutRule = {
      ...base,
      type: "safe-rollout",
      controlValue: input.controlValue,
      variationValue: input.variationValue,
      safeRolloutId: "", // filled after SafeRollout entity is created
      hashAttribute: input.hashAttribute,
      trackingKey:
        input.trackingKey ?? `${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}${uuidv4()}`,
      seed: input.seed ?? uuidv4(),
      status: "running",
    };
    return rule;
  }

  // Force vs rollout: rollout when coverage < 1 or explicitly requested.
  const isRollout =
    input.type === "rollout" ||
    (input.type !== "force" &&
      input.coverage !== undefined &&
      input.coverage < 1);

  if (isRollout) {
    if (!input.hashAttribute) {
      throw new BadRequestError(
        "hashAttribute is required for rollout rules (coverage < 100%)",
      );
    }
    const rule: RolloutRule = {
      ...base,
      type: "rollout",
      value: input.value,
      coverage: input.coverage ?? 1,
      hashAttribute: input.hashAttribute,
      ...(input.seed !== undefined && { seed: input.seed }),
      hashVersion: (input.hashVersion as 1 | 2 | undefined) ?? 2,
      ...(input.sparse !== undefined && { sparse: input.sparse }),
    };
    return rule;
  }

  const rule: ForceRule = {
    ...base,
    type: "force",
    value: input.value,
    ...(input.sparse !== undefined && { sparse: input.sparse }),
  };
  return rule;
}

export const postFeatureRevisionRuleAdd = createApiRequestHandler(
  postFeatureRevisionRuleAddValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { environment, schedule } = req.body;
  assertValidEnvironment(req.context, environment);
  const inlineRampSchedule = req.body.rampSchedule;
  const ruleInput = req.body.rule;

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: req.body.revisionTitle, comment: req.body.revisionComment },
  );

  // Track side effects so we can compensate on downstream failure (discard
  // draft, delete orphan SafeRollout, revert experiment/holdout auto-link).
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

    // Fill missing variationIds from the linked experiment by index. For
    // holdout-bound features, also enforces experiment/holdout compatibility.
    if (ruleInput.type === "experiment-ref") {
      const anyMissing = ruleInput.variations.some((v) => !v.variationId);
      const allMissing = ruleInput.variations.every((v) => !v.variationId);
      if (anyMissing && !allMissing) {
        throw new BadRequestError(
          "Either provide variationId for all variations or none; mixed inputs are not allowed.",
        );
      }
      // Always resolve the experiment to check for missing variations
      // and to check for holdout compatibility
      const experiment = await getExperimentById(
        req.context,
        ruleInput.experimentId,
      );
      if (!experiment) {
        throw new NotFoundError(
          `Could not find experiment "${ruleInput.experimentId}"`,
        );
      }

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

      // Use target revision holdout to check compatibility
      const effectiveHoldout = revision.holdout ?? null;
      if (effectiveHoldout?.id) {
        if (experiment.status !== "draft") {
          throw new BadRequestError(
            `Cannot add experiment rule: this feature uses a holdout, so the experiment must be in "draft" status (currently "${experiment.status}").`,
          );
        }
        const expHasLinkedChanges =
          (experiment.linkedFeatures?.length ?? 0) > 0 ||
          experiment.hasURLRedirects ||
          experiment.hasVisualChangesets;
        if (expHasLinkedChanges) {
          throw new BadRequestError(
            `Cannot add experiment rule: this feature uses a holdout, but the experiment already has linked features, URL redirects, or visual changesets. Unlink them first.`,
          );
        }
        if (
          experiment.holdoutId &&
          experiment.holdoutId !== effectiveHoldout.id
        ) {
          const featureHoldout = await req.context.models.holdout.getById(
            effectiveHoldout.id,
          );
          const expHoldout = experiment.holdoutId
            ? await req.context.models.holdout.getById(experiment.holdoutId)
            : null;
          throw new BadRequestError(
            `Cannot add experiment rule: experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}" but this feature uses holdout "${featureHoldout?.name || effectiveHoldout.id}".`,
          );
        }

        if (!experiment.holdoutId) {
          // Deferred until after custom-hook prevalidation below
          holdoutExperimentToLink = experiment;
        }
      } else if (experiment.holdoutId) {
        const expHoldout = await req.context.models.holdout.getById(
          experiment.holdoutId,
        );
        throw new BadRequestError(
          `Cannot add experiment rule: this experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}", but this feature is not in a holdout. Add the feature to that holdout first, then add the experiment.`,
        );
      }
    }

    const rule = buildRuleFromInput(ruleInput, uuidv4());

    // Enforce the feature's JSON schema on the new rule's values (no-op for
    // config-backed values). Opt out with ?skipSchemaValidation=true.
    assertFeatureValuesValid(req.context, feature, { rules: [rule] });

    // Validate condition JSON and references before any DB writes.
    validateRuleConditions(rule);
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

      // Strip inline `rampUpSchedule.enabled` shorthand before validation;
      // the stored ramp-up shape is larger.
      const { rampUpSchedule, ...validatableFields } =
        ruleInput.safeRolloutFields;
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

    // Priority: rampSchedule > schedule shorthand > inline scheduleRules (legacy).
    let resolvedRampAction = inlineRampSchedule
      ? normalizeInlineRampSchedule(inlineRampSchedule, rule.id)
      : undefined;
    if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
      // A startDate implies the rule should be disabled until the ramp fires.
      if (schedule.startDate) rule.enabled = false;
      resolvedRampAction = buildScheduleRampAction(
        rule.id,
        schedule.startDate,
        schedule.endDate,
      );
    }

    // v2: rules live on a flat top-level array. Stamp the new rule with
    // single-env scope and append to the existing array.
    const baseRules = cloneDeep(revision.rules ?? []);
    const stampedRule: FeatureRule = {
      ...rule,
      allEnvironments: false,
      environments: [environment],
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

    const resetReview = resetReviewOnChange({
      feature,
      changedEnvironments: [environment],
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
      await updateExperiment({
        context: req.context,
        experiment: holdoutExperimentToLink,
        changes: { holdoutId: feature.holdout.id },
      });
      linkedExperimentId = holdoutExperimentToLink.id;
      const holdout = await req.context.models.holdout.getById(
        feature.holdout.id,
      );
      await req.context.models.holdout.updateById(feature.holdout.id, {
        linkedExperiments: {
          ...holdout?.linkedExperiments,
          [holdoutExperimentToLink.id]: {
            id: holdoutExperimentToLink.id,
            dateAdded: new Date(),
          },
        },
      });
      linkedHoldoutId = feature.holdout.id;
    }

    await updateRevision(
      req.context,
      feature,
      revision,
      changes,
      {
        user: req.context.auditUser,
        action: "add rule",
        subject: `to ${environment}`,
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
        environments: [environment],
        auditDetails: { ruleId: rule.id, ruleType: rule.type },
      },
    );

    return { revision: toApiRevision(finalRevision, req.context, feature) };
  } catch (err) {
    if (createdSafeRolloutId) {
      try {
        await req.context.models.safeRollout.deleteById(createdSafeRolloutId);
      } catch {
        // best effort
      }
    }
    if (linkedExperimentId) {
      try {
        const exp = await getExperimentById(req.context, linkedExperimentId);
        if (exp) {
          await updateExperiment({
            context: req.context,
            experiment: exp,
            changes: { holdoutId: "" },
          });
        }
      } catch {
        // best effort
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
        // best effort
      }
    }
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
