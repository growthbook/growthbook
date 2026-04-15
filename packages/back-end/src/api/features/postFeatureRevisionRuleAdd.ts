import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  savedGroupTargeting,
  featurePrerequisite,
  RevisionRampCreateAction,
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
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  createRevision,
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "back-end/src/util/errors";
import {
  assertValidEnvironment,
  isDraftStatus,
  inlineRampScheduleInput,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  validateRuleConditions,
  validateRuleReferences,
} from "./validations";

const SAFE_ROLLOUT_TRACKING_KEY_PREFIX = "sr-";

const scheduleRuleInput = z.object({
  timestamp: z.string().nullable(),
  enabled: z.boolean(),
});

// Optional fields shared by every rule type
const commonCreateFields = {
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  scheduleRules: z.array(scheduleRuleInput).optional(),
  scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
};

// Force / rollout — type inferred from coverage:
//   coverage < 1  →  rollout  (hashAttribute required)
//   otherwise     →  force
const forceRolloutCreateInput = z.object({
  ...commonCreateFields,
  type: z.enum(["force", "rollout"]).optional(),
  value: z.string(),
  coverage: z.number().min(0).max(1).optional(),
  hashAttribute: z.string().optional(),
  seed: z.string().optional(),
});

const experimentRefCreateInput = z.object({
  ...commonCreateFields,
  type: z.literal("experiment-ref"),
  experimentId: z.string(),
  variations: z.array(
    z.object({ variationId: z.string().optional(), value: z.string() }),
  ),
});

// Safe rollout — safeRolloutId is server-generated; caller supplies monitoring config
const safeRolloutCreateInput = z.object({
  ...commonCreateFields,
  type: z.literal("safe-rollout"),
  controlValue: z.string(),
  variationValue: z.string(),
  hashAttribute: z.string(),
  trackingKey: z.string().optional(),
  seed: z.string().optional(),
  safeRolloutFields: z.object({
    datasourceId: z.string(),
    exposureQueryId: z.string(),
    guardrailMetricIds: z.array(z.string()),
    maxDuration: z.object({
      amount: z.number().positive(),
      unit: z.enum(["weeks", "days", "hours", "minutes"]),
    }),
    autoRollback: z.boolean().optional().default(false),
    rampUpSchedule: z
      .object({
        enabled: z.boolean(),
      })
      .optional(),
  }),
});

// Union tries experiment-ref/safe-rollout first (explicit `type` literal);
// forceRollout is the fallback — also catches type: undefined.
const ruleCreateInput = z.union([
  experimentRefCreateInput,
  safeRolloutCreateInput,
  forceRolloutCreateInput,
]);

type RuleCreateInput = z.infer<typeof ruleCreateInput>;

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
    // safeRolloutId is filled in after entity creation in the handler
    const rule: SafeRolloutRule = {
      ...base,
      type: "safe-rollout",
      controlValue: input.controlValue,
      variationValue: input.variationValue,
      safeRolloutId: "", // filled below
      hashAttribute: input.hashAttribute,
      trackingKey:
        input.trackingKey ?? `${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}${uuidv4()}`,
      seed: input.seed ?? uuidv4(),
      status: "running",
    };
    return rule;
  }

  // Force / rollout inference
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

export const postFeatureRevisionRuleAdd = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.union([z.coerce.number().int(), z.literal("new")]),
  }),
  bodySchema: z.object({
    environment: z.string(),
    rule: ruleCreateInput,
    rampSchedule: inlineRampScheduleInput.optional(),
    schedule: z
      .object({
        startDate: z.string().optional().nullable(),
        endDate: z.string().optional().nullable(),
      })
      .optional(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision =
    req.params.version === "new"
      ? await createRevision({
          context: req.context,
          feature,
          user: req.context.auditUser,
          baseVersion: feature.version,
          comment: "",
          environments: getEnvironmentIdsFromOrg(req.context.org),
          publish: false,
          changes: {},
          org: req.context.org,
          canBypassApprovalChecks: false,
        })
      : await getRevision({
          context: req.context,
          organization: req.organization.id,
          featureId: feature.id,
          version: req.params.version,
        });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${revision.status}"`,
    );
  }

  const { environment, schedule } = req.body;
  assertValidEnvironment(req.context, environment);
  const inlineRampSchedule = req.body.rampSchedule;
  const ruleInput = req.body.rule;

  // Fill in missing variationIds from the linked experiment (by index order).
  // Also enforce holdout compatibility for experiment-ref rules on holdout-bound
  // features, mirroring postFeatureRule controller: the experiment must be in
  // draft status, have no linked changes, and (if it already has a holdout)
  // match the feature's holdout. If accepted, link the experiment to the
  // feature's holdout (both on the experiment and the holdout's linkedExperiments).
  if (ruleInput.type === "experiment-ref") {
    const anyMissing = ruleInput.variations.some((v) => !v.variationId);
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
        ruleInput.variations = ruleInput.variations.map((v, i) => ({
          variationId: v.variationId ?? experiment.variations[i]?.id ?? "",
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
        }
      }
    }
  }

  const rule = buildRuleFromInput(ruleInput, uuidv4());

  // Validate condition JSON and entity references before any DB writes
  validateRuleConditions(rule);
  await validateRuleReferences(rule, req.context);

  // Safe rollout: create the SafeRollout entity and link it to the rule
  if (ruleInput.type === "safe-rollout" && rule.type === "safe-rollout") {
    if (!req.context.hasPremiumFeature("safe-rollout")) {
      req.context.throwPlanDoesNotAllowError(
        "Safe Rollout rules require an Enterprise plan.",
      );
    }

    // omit our inline rampUpSchedule input (only contains `enabled`) before
    // validation so it doesn't collide with the stored ramp-up shape
    const { rampUpSchedule, ...validatableFields } =
      ruleInput.safeRolloutFields;
    const validatedFields = await validateCreateSafeRolloutFields(
      validatableFields,
      req.context,
    );

    const safeRollout = await req.context.models.safeRollout.create({
      ...validatedFields,
      environment,
      featureId: feature.id,
      status: "running",
      autoSnapshots: true,
      rampUpSchedule: {
        // Controlled by an internal feature flag in the full app — honor
        // caller input when provided, default off otherwise.
        enabled: rampUpSchedule?.enabled ?? false,
        step: 0,
        steps: [
          { percent: 0.1 },
          { percent: 0.25 },
          { percent: 0.5 },
          { percent: 0.75 },
          { percent: 1 },
        ],
        rampUpCompleted: false,
        nextUpdate: undefined,
      },
    });

    if (!safeRollout)
      throw new InternalServerError("Failed to create safe rollout");
    (rule as SafeRolloutRule).safeRolloutId = safeRollout.id;
  }

  // Resolve which ramp action to attach (if any).
  // Priority: rampSchedule > schedule shorthand > inline scheduleRules (legacy, deprecated).
  // ruleId is injected here now that we have the server-generated rule ID.
  let resolvedRampAction = inlineRampSchedule
    ? normalizeInlineRampSchedule(inlineRampSchedule, rule.id, environment)
    : undefined;
  if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
    // New rule: always create a ramp action. If startDate set, the rule starts disabled.
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

  return { revision: omit(updated ?? revision, "organization") };
});
