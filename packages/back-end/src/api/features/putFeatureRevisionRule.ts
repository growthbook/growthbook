import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import {
  savedGroupTargeting,
  featurePrerequisite,
  revisionRampCreateAction,
  revisionRampDetachAction,
  RevisionRampCreateAction,
  RevisionRampDetachAction,
  ExperimentRefRule,
  RolloutRule,
  ForceRule,
  SafeRolloutRule,
  FeatureRule,
} from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { isDraftStatus, buildScheduleRampAction } from "./validations";

const rampActionSchema = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampDetachAction,
]);

const scheduleRuleInput = z.object({
  timestamp: z.string().nullable(),
  enabled: z.boolean(),
});

// Common editable fields shared by all rule types
const commonPatch = {
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  scheduleRules: z.array(scheduleRuleInput).optional(),
  scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
};

// Type-specific editable fields. All optional so callers send only what they want to change.
const rulePatchSchema = z.object({
  ...commonPatch,
  // Force / rollout fields (coverage re-infers the type post-patch)
  value: z.string().optional(),
  coverage: z.number().min(0).max(1).optional(),
  hashAttribute: z.string().optional(),
  seed: z.string().optional(),
  // Experiment-ref fields
  experimentId: z.string().optional(),
  variations: z
    .array(z.object({ variationId: z.string(), value: z.string() }))
    .optional(),
  // Safe-rollout fields
  controlValue: z.string().optional(),
  variationValue: z.string().optional(),
});

type RulePatch = z.infer<typeof rulePatchSchema>;

function applyPatch(existing: FeatureRule, patch: RulePatch): FeatureRule {
  const type = existing.type;

  const commonUpdates = {
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    ...(patch.condition !== undefined && { condition: patch.condition }),
    ...(patch.savedGroups !== undefined && { savedGroups: patch.savedGroups }),
    ...(patch.prerequisites !== undefined && {
      prerequisites: patch.prerequisites,
    }),
    ...(patch.scheduleRules !== undefined && {
      scheduleRules: patch.scheduleRules,
    }),
    ...(patch.scheduleType !== undefined && {
      scheduleType: patch.scheduleType,
    }),
  };

  if (type === "experiment-ref") {
    if (
      patch.value !== undefined ||
      patch.coverage !== undefined ||
      patch.controlValue !== undefined
    ) {
      throw new Error(
        "value, coverage, and controlValue cannot be set on an experiment-ref rule",
      );
    }
    const updated: ExperimentRefRule = {
      ...(existing as ExperimentRefRule),
      ...commonUpdates,
      ...(patch.experimentId !== undefined && {
        experimentId: patch.experimentId,
      }),
      ...(patch.variations !== undefined && { variations: patch.variations }),
    };
    return updated;
  }

  if (type === "safe-rollout") {
    if (patch.value !== undefined || patch.coverage !== undefined) {
      throw new Error(
        "value and coverage cannot be set on a safe-rollout rule",
      );
    }
    if (patch.experimentId !== undefined || patch.variations !== undefined) {
      throw new Error(
        "experimentId and variations cannot be set on a safe-rollout rule",
      );
    }
    const updated: SafeRolloutRule = {
      ...(existing as SafeRolloutRule),
      ...commonUpdates,
      ...(patch.controlValue !== undefined && {
        controlValue: patch.controlValue,
      }),
      ...(patch.variationValue !== undefined && {
        variationValue: patch.variationValue,
      }),
      ...(patch.hashAttribute !== undefined && {
        hashAttribute: patch.hashAttribute,
      }),
    };
    return updated;
  }

  // Force / rollout: apply patch then re-infer type from effective coverage
  if (type === "force" || type === "rollout") {
    if (patch.experimentId !== undefined || patch.variations !== undefined) {
      throw new Error(
        "experimentId and variations cannot be set on a force/rollout rule",
      );
    }
    if (
      patch.controlValue !== undefined ||
      patch.variationValue !== undefined
    ) {
      throw new Error(
        "controlValue and variationValue cannot be set on a force/rollout rule",
      );
    }

    const effectiveCoverage =
      patch.coverage ?? (existing as RolloutRule).coverage;
    const effectiveHashAttr =
      patch.hashAttribute ?? (existing as RolloutRule).hashAttribute;
    const effectiveValue =
      patch.value ?? (existing as ForceRule | RolloutRule).value;

    // Re-infer: coverage < 1 → rollout (hashAttribute required), otherwise → force
    const isRollout = effectiveCoverage !== undefined && effectiveCoverage < 1;

    if (isRollout) {
      if (!effectiveHashAttr) {
        throw new Error(
          "hashAttribute is required for rollout rules (coverage < 100%)",
        );
      }
      const updated: RolloutRule = {
        ...(existing as RolloutRule),
        ...commonUpdates,
        type: "rollout",
        value: effectiveValue ?? "",
        coverage: effectiveCoverage,
        hashAttribute: effectiveHashAttr,
        ...(patch.seed !== undefined && { seed: patch.seed }),
      };
      return updated;
    } else {
      const updated: ForceRule = {
        ...(existing as ForceRule),
        ...commonUpdates,
        type: "force",
        value: effectiveValue ?? "",
        ...(effectiveCoverage !== undefined && {
          coverage: effectiveCoverage,
        }),
        ...(effectiveHashAttr !== undefined && {
          hashAttribute: effectiveHashAttr,
        }),
        ...(patch.seed !== undefined && { seed: patch.seed }),
      };
      return updated;
    }
  }

  throw new Error(`Unknown rule type: ${type}`);
}

export const putFeatureRevisionRule = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.coerce.number().int(),
    ruleId: z.string(),
  }),
  bodySchema: z.object({
    environment: z.string(),
    rule: rulePatchSchema,
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
  const patch = req.body.rule;

  const newRules = cloneDeep(revision.rules ?? {});
  const envRules = newRules[environment] ?? [];
  const idx = envRules.findIndex((r) => r.id === req.params.ruleId);
  if (idx === -1) {
    throw new Error(
      `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
    );
  }

  const oldRule = envRules[idx];

  // Block creating a new schedule if the rule already has one (pending on this
  // revision or already live). The caller should update it via PUT /ramp-schedules/:id.
  const wantsNewSchedule =
    rampAction?.mode === "create" ||
    Boolean(schedule?.startDate) ||
    Boolean(schedule?.endDate);
  if (wantsNewSchedule) {
    const hasPendingCreate = (revision.rampActions ?? []).some(
      (a) => a.mode === "create" && a.ruleId === req.params.ruleId,
    );
    const liveSchedules =
      await req.context.models.rampSchedules.findByTargetRule(
        req.params.ruleId,
        environment,
      );
    if (hasPendingCreate || liveSchedules.length > 0) {
      const hint =
        liveSchedules.length > 0
          ? ` Update it via PUT /api/v1/ramp-schedules/${liveSchedules[0].id}.`
          : " The schedule will be created when the revision is published; update the revision's rampActions instead.";
      throw new Error(
        `Rule "${req.params.ruleId}" already has a ramp schedule.${hint}`,
      );
    }
  }
  const updatedRule = applyPatch(oldRule, patch);
  envRules[idx] = updatedRule;
  newRules[environment] = envRules;

  const changes: RevisionChanges = { rules: newRules };

  // Resolve schedule. Priority: explicit rampAction > schedule shorthand.
  let resolvedRampAction = rampAction;
  if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
    const hasLegacySchedule =
      oldRule.scheduleType === "schedule" ||
      (oldRule.scheduleRules?.some((r) => r.timestamp) &&
        oldRule.scheduleType !== "ramp");

    if (hasLegacySchedule) {
      // Update legacy scheduleRules in-place on the updated rule
      updatedRule.scheduleRules = [
        { enabled: true, timestamp: schedule.startDate ?? null },
        { enabled: false, timestamp: schedule.endDate ?? null },
      ];
      updatedRule.scheduleType = "schedule";
    } else {
      if (schedule.startDate) updatedRule.enabled = false;
      resolvedRampAction = buildScheduleRampAction(
        updatedRule.id,
        environment,
        schedule.startDate,
        schedule.endDate,
      );
    }
  }

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
      action: "edit rule",
      subject: req.params.ruleId,
      value: JSON.stringify(updatedRule),
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
