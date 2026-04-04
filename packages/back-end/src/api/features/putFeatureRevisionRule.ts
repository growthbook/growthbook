import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import {
  featureRule,
  revisionRampCreateAction,
  revisionRampDetachAction,
  RevisionRampCreateAction,
  RevisionRampDetachAction,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision
} from "back-end/src/models/FeatureRevisionModel";
import { RevisionChanges } from "shared/types/feature-revision";
import { isDraftStatus, buildScheduleRampAction } from "./validations";

const rampActionSchema = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampDetachAction,
]);

export const putFeatureRevisionRule = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.coerce.number().int(),
    ruleId: z.string(),
  }),
  bodySchema: z.object({
    environment: z.string(),
    // Full replacement rule — caller provides the complete updated rule object.
    // The rule.id must match the :ruleId param.
    rule: featureRule,
    rampAction: rampActionSchema.optional(),
    // Simple date-based schedule shorthand. Preferred over setting rule.scheduleRules directly.
    // Ignored when rampAction is also provided.
    // If the existing rule already uses legacy scheduleRules, those are updated instead.
    schedule: z
      .object({
        startDate: z.string().optional().nullable(),
        endDate: z.string().optional().nullable(),
      })
      .optional(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

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
  if (!revision) throw new Error("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { environment, rampAction, schedule } = req.body;
  const rule = req.body.rule;

  if (rule.id !== req.params.ruleId) {
    throw new Error(
      `rule.id "${rule.id}" does not match the :ruleId param "${req.params.ruleId}"`,
    );
  }

  const newRules = cloneDeep(revision.rules ?? {});
  const envRules = newRules[environment] ?? [];
  const idx = envRules.findIndex((r) => r.id === req.params.ruleId);
  if (idx === -1) {
    throw new Error(
      `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
    );
  }

  const oldRule = envRules[idx];
  envRules[idx] = rule;
  newRules[environment] = envRules;

  const changes: RevisionChanges = { rules: newRules };

  // Resolve schedule. Priority: explicit rampAction > schedule shorthand.
  let resolvedRampAction = rampAction;
  if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
    const hasLegacySchedule = oldRule.scheduleType === "schedule" ||
      (oldRule.scheduleRules?.some((r) => r.timestamp) &&
        oldRule.scheduleType !== "ramp");

    if (hasLegacySchedule) {
      // Update legacy scheduleRules in-place on the submitted rule
      rule.scheduleRules = [
        { enabled: true, timestamp: schedule.startDate ?? null },
        { enabled: false, timestamp: schedule.endDate ?? null },
      ];
      rule.scheduleType = "schedule";
    } else {
      // No legacy schedule: create a ramp action
      if (schedule.startDate) rule.enabled = false;
      resolvedRampAction = buildScheduleRampAction(
        rule.id,
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
            a.ruleId === (resolvedRampAction as RevisionRampCreateAction).ruleId) ||
          (a.mode === "detach" &&
            a.ruleId === (resolvedRampAction as RevisionRampDetachAction).ruleId)
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
      value: JSON.stringify(rule),
    },
    true,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
