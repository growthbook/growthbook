import cloneDeep from "lodash/cloneDeep";
import { v4 as uuidv4 } from "uuid";
import {
  RevisionRampCreateAction,
  postFeatureRevisionRuleAddValidator,
  RuleCreateInput,
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
import { getLatestPhaseVariations } from "shared/experiments";
import { revisionToApiInterface } from "back-end/src/services/features";
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
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  resolveOrCreateRevision,
  validateRuleConditions,
  validateRuleReferences,
} from "./validations";

const SAFE_ROLLOUT_TRACKING_KEY_PREFIX = "sr-";

function buildRuleFromInput(input: RuleCreateInput, id: string): FeatureRule {
  const base = {
    id,
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
    };
    return rule;
  }

  const rule: ForceRule = {
    ...base,
    type: "force",
    value: input.value,
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
      const needsHoldoutCheck = Boolean(feature.holdout?.id);
      if (anyMissing || needsHoldoutCheck) {
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

        if (needsHoldoutCheck && feature.holdout?.id) {
          const expHasLinkedChanges =
            (experiment.linkedFeatures?.length ?? 0) > 0 ||
            experiment.hasURLRedirects ||
            experiment.hasVisualChangesets;
          if (
            experiment.status !== "draft" ||
            (experiment.holdoutId &&
              experiment.holdoutId !== feature.holdout.id) ||
            expHasLinkedChanges
          ) {
            throw new BadRequestError(
              "Failed to create experiment rule. Experiment has linked changes, is not in draft status, or is not linked to the same holdout as the feature.",
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
                [experiment.id]: {
                  id: experiment.id,
                  dateAdded: new Date(),
                },
              },
            });
            linkedHoldoutId = feature.holdout.id;
          }
        }
      }
    }

    const rule = buildRuleFromInput(ruleInput, uuidv4());

    // Validate condition JSON and references before any DB writes.
    validateRuleConditions(rule);
    await validateRuleReferences(rule, req.context);

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
      const safeRollout = await req.context.models.safeRollout.create({
        ...validatedFields,
        environment,
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

    // Priority: rampSchedule > schedule shorthand > inline scheduleRules (legacy).
    let resolvedRampAction = inlineRampSchedule
      ? normalizeInlineRampSchedule(inlineRampSchedule, rule.id, environment)
      : undefined;
    if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
      // A startDate implies the rule should be disabled until the ramp fires.
      if (schedule.startDate) rule.enabled = false;
      resolvedRampAction = buildScheduleRampAction(
        rule.id,
        environment,
        schedule.startDate,
        schedule.endDate,
      );
    }

    const newRules = cloneDeep(revision.rules ?? {});
    newRules[environment] = [...(newRules[environment] ?? []), rule];

    const changes: RevisionChanges = { rules: newRules };

    if (resolvedRampAction) {
      const existing = revision.rampActions ?? [];
      const filtered = existing.filter(
        (a) =>
          a.ruleId !== (resolvedRampAction as RevisionRampCreateAction).ruleId,
      );
      changes.rampActions = [...filtered, resolvedRampAction];
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
      resetReviewOnChange({
        feature,
        changedEnvironments: [environment],
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
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

    return { revision: revisionToApiInterface(finalRevision) };
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
          const { [linkedExperimentId]: _omit, ...rest } =
            holdout.linkedExperiments;
          await req.context.models.holdout.updateById(linkedHoldoutId, {
            linkedExperiments: rest,
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
