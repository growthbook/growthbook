import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import { v4 as uuidv4 } from "uuid";
import {
  RevisionRampCreateAction,
  postFeatureRevisionRuleAddV2Validator,
  RuleCreateInput,
  RuleCreateInputV2,
} from "shared/validators";
import type { FeatureRule, SafeRolloutRule } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  toApiRevisionV2,
  addIdsToFlatRules,
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
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
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
import { resolveScopeFromInput } from "./v2Shared";

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
  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    if (ruleInput.type === "experiment-ref") {
      const anyMissing = ruleInput.variations.some((v) => !v.variationId);
      const allMissing = ruleInput.variations.every((v) => !v.variationId);
      if (anyMissing && !allMissing) {
        throw new BadRequestError(
          "Either provide variationId for all variations or none; mixed inputs are not allowed.",
        );
      }
      const needsHoldoutCheck = Boolean(feature.holdout?.id);
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

        if (needsHoldoutCheck && feature.holdout?.id) {
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
            experiment.holdoutId !== feature.holdout.id
          ) {
            const featureHoldout = await req.context.models.holdout.getById(
              feature.holdout.id,
            );
            const expHoldout = experiment.holdoutId
              ? await req.context.models.holdout.getById(experiment.holdoutId)
              : null;
            throw new BadRequestError(
              `Cannot add experiment rule: experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}" but this feature uses holdout "${featureHoldout?.name || feature.holdout.id}".`,
            );
          }
          if (!experiment.holdoutId) {
            await updateExperiment({
              context: req.context,
              experiment,
              changes: { holdoutId: feature.holdout.id },
            });
            linkedExperimentId = experiment.id;
            const holdout = await req.context.models.holdout.getById(
              feature.holdout.id,
            );
            await req.context.models.holdout.updateById(feature.holdout.id, {
              linkedExperiments: {
                ...holdout?.linkedExperiments,
                [experiment.id]: { id: experiment.id, dateAdded: new Date() },
              },
            });
            linkedHoldoutId = feature.holdout.id;
          }
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

    // Backfill seed for rollout rules to ensure ramp-monitored payload
    // stability — consistent with the write-time backfill in addIdsToFlatRules.
    addIdsToFlatRules([rule as FeatureRule], feature.id);

    validateRuleConditions(rule);
    // Opt-in registered-attribute check before any side effects (safe-rollout
    // create, revision update). New rules have no baseline, so this validates
    // every attribute-bearing field on the incoming rule.
    validateRuleAttributes(rule, req.context, feature.project);
    await validateRuleReferences(rule, req.context);

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
      const safeRollout = await req.context.models.safeRollout.create({
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
      });

      if (!safeRollout)
        throw new InternalServerError("Failed to create safe rollout");
      createdSafeRolloutId = safeRollout.id;
      (rule as SafeRolloutRule).safeRolloutId = safeRollout.id;
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
      resetReviewOnChange({
        feature,
        changedEnvironments: affectedEnvs,
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
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
