import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { z } from "zod";
import {
  savedGroupTargeting,
  featurePrerequisite,
  RevisionRampCreateAction,
  ExperimentRefRule,
  RolloutRule,
  ForceRule,
  SafeRolloutRule,
  FeatureRule,
} from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  assertValidEnvironment,
  isDraftStatus,
  inlineRampScheduleInput,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  validateRuleConditions,
  validateRuleReferences,
} from "./validations";

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
// `type` may be included as a re-assertion hint (must match the existing rule's type — it cannot
// be changed). Providing it enables client-side schema selection in codegen / IDE tooling.
const rulePatchSchema = z.object({
  ...commonPatch,
  // Optional re-assertion: if provided, must match the existing rule type
  type: z
    .enum(["force", "rollout", "experiment-ref", "safe-rollout"])
    .optional(),
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

  if (patch.type !== undefined && patch.type !== type) {
    throw new BadRequestError(
      `Rule type cannot be changed (existing: "${type}", provided: "${patch.type}"). ` +
        "Delete this rule and add a new one to change its type.",
    );
  }

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
      throw new BadRequestError(
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
      throw new BadRequestError(
        "value and coverage cannot be set on a safe-rollout rule",
      );
    }
    if (patch.experimentId !== undefined || patch.variations !== undefined) {
      throw new BadRequestError(
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
      throw new BadRequestError(
        "experimentId and variations cannot be set on a force/rollout rule",
      );
    }
    if (
      patch.controlValue !== undefined ||
      patch.variationValue !== undefined
    ) {
      throw new BadRequestError(
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
        throw new BadRequestError(
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

  throw new BadRequestError(`Unknown rule type: ${type}`);
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

  const revision = await getRevision({
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
  const patch = req.body.rule;

  const newRules = cloneDeep(revision.rules ?? {});
  const envRules = newRules[environment] ?? [];
  const idx = envRules.findIndex((r) => r.id === req.params.ruleId);
  if (idx === -1) {
    throw new NotFoundError(
      `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
    );
  }

  const oldRule = envRules[idx];

  // Safe rollout: once the rollout has started, block changes to fields that
  // would corrupt the running experiment. Mirrors putFeatureRule controller.
  if (oldRule.type === "safe-rollout") {
    const safeRollout = await req.context.models.safeRollout.getById(
      oldRule.safeRolloutId,
    );
    if (safeRollout?.startedAt !== undefined) {
      const immutableFieldChanges: string[] = [];
      if (
        patch.controlValue !== undefined &&
        !isEqual(patch.controlValue, oldRule.controlValue)
      ) {
        immutableFieldChanges.push("controlValue");
      }
      if (
        patch.variationValue !== undefined &&
        !isEqual(patch.variationValue, oldRule.variationValue)
      ) {
        immutableFieldChanges.push("variationValue");
      }
      if (
        patch.hashAttribute !== undefined &&
        !isEqual(patch.hashAttribute, oldRule.hashAttribute)
      ) {
        immutableFieldChanges.push("hashAttribute");
      }
      if (patch.seed !== undefined && !isEqual(patch.seed, oldRule.seed)) {
        immutableFieldChanges.push("seed");
      }
      if (immutableFieldChanges.length > 0) {
        throw new BadRequestError(
          `Cannot update the following fields after a Safe Rollout has started: ${immutableFieldChanges.join(", ")}`,
        );
      }
    }
  }

  // Block creating a new schedule if the rule already has a LIVE schedule.
  // A pending create on this revision is allowed (it will be replaced below).
  // Only check when we'd actually be creating a new schedule.
  const wantsNewSchedule =
    Boolean(inlineRampSchedule) ||
    (!inlineRampSchedule &&
      (Boolean(schedule?.startDate) || Boolean(schedule?.endDate)));
  if (wantsNewSchedule) {
    const liveSchedules =
      await req.context.models.rampSchedules.findByTargetRule(
        req.params.ruleId,
        environment,
      );
    if (liveSchedules.length > 0) {
      throw new BadRequestError(
        `Rule "${req.params.ruleId}" already has a live ramp schedule.` +
          ` Update it via PUT /api/v1/ramp-schedules/${liveSchedules[0].id}.`,
      );
    }
  }
  const updatedRule = applyPatch(oldRule, patch);

  // Validate condition JSON and entity references only for fields explicitly in the patch.
  // We don't re-validate pre-existing values that weren't touched — the internal app
  // doesn't do this either, and doing so could block edits to rules whose conditions
  // reference since-deleted saved groups or prerequisite features.
  validateRuleConditions({
    condition:
      patch.condition !== undefined ? updatedRule.condition : undefined,
    prerequisites:
      patch.prerequisites !== undefined ? updatedRule.prerequisites : [],
  });
  if (
    patch.condition !== undefined ||
    patch.savedGroups !== undefined ||
    patch.prerequisites !== undefined
  ) {
    await validateRuleReferences(
      {
        condition:
          patch.condition !== undefined ? updatedRule.condition : undefined,
        savedGroups:
          patch.savedGroups !== undefined ? updatedRule.savedGroups : [],
        prerequisites:
          patch.prerequisites !== undefined ? updatedRule.prerequisites : [],
      },
      req.context,
    );
  }

  envRules[idx] = updatedRule;
  newRules[environment] = envRules;

  const changes: RevisionChanges = { rules: newRules };

  // Resolve schedule. Priority: rampSchedule > schedule shorthand (legacy: scheduleRules).
  let resolvedRampAction = inlineRampSchedule
    ? normalizeInlineRampSchedule(
        inlineRampSchedule,
        updatedRule.id,
        environment,
      )
    : undefined;
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
