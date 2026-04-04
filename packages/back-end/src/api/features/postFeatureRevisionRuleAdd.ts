import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  savedGroupTargeting,
  featurePrerequisite,
  revisionRampCreateAction,
  revisionRampDetachAction,
  RevisionRampCreateAction,
  RevisionRampDetachAction,
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
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import { NotFoundError } from "back-end/src/util/errors";
import { isDraftStatus, buildScheduleRampAction } from "./validations";

const SAFE_ROLLOUT_TRACKING_KEY_PREFIX = "sr-";

const rampActionSchema = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampDetachAction,
]);

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
      throw new Error(
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
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    environment: z.string(),
    rule: ruleCreateInput,
    rampAction: rampActionSchema.optional(),
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

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { environment, rampAction, schedule } = req.body;
  const ruleInput = req.body.rule;

  // Fill in missing variationIds from the linked experiment (by index order)
  if (ruleInput.type === "experiment-ref") {
    const anyMissing = ruleInput.variations.some((v) => !v.variationId);
    if (anyMissing) {
      const experiment = await getExperimentById(
        req.context,
        ruleInput.experimentId,
      );
      if (!experiment) {
        throw new Error(
          `Could not find experiment "${ruleInput.experimentId}" to resolve variation IDs`,
        );
      }
      ruleInput.variations = ruleInput.variations.map((v, i) => ({
        variationId: v.variationId ?? experiment.variations[i]?.id ?? "",
        value: v.value,
      }));
    }
  }

  const rule = buildRuleFromInput(ruleInput, uuidv4());

  // Safe rollout: create the SafeRollout entity and link it to the rule
  if (ruleInput.type === "safe-rollout" && rule.type === "safe-rollout") {
    if (!req.context.hasPremiumFeature("safe-rollout")) {
      throw new Error("Safe Rollout rules require a premium plan.");
    }

    const validatedFields = await validateCreateSafeRolloutFields(
      ruleInput.safeRolloutFields,
      req.context,
    );

    const safeRollout = await req.context.models.safeRollout.create({
      ...validatedFields,
      environment,
      featureId: feature.id,
      status: "running",
      autoSnapshots: true,
      rampUpSchedule: {
        enabled: false,
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

    if (!safeRollout) throw new Error("Failed to create safe rollout");
    (rule as SafeRolloutRule).safeRolloutId = safeRollout.id;
  }

  // Resolve which ramp action to attach (if any).
  // Priority: explicit rampAction > schedule shorthand > inline scheduleRules (legacy, deprecated)
  let resolvedRampAction = rampAction;
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
        !(
          (a.mode === "create" &&
            a.ruleId ===
              (resolvedRampAction as RevisionRampCreateAction).ruleId) ||
          (a.mode === "detach" &&
            a.ruleId ===
              (resolvedRampAction as RevisionRampDetachAction).ruleId)
        ),
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
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
