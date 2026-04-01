import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  rampStep,
  rampStepAction,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
} from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";

const postRampScheduleValidator = {
  bodySchema: z.object({
    name: z.string(),
    // The feature and rule this schedule controls.
    // The rule must already be live (published) before creating a schedule via REST.
    featureId: z.string(),
    ruleId: z.string(),
    environment: z.string(),
    steps: z.array(rampStep).min(0).optional(),
    endActions: z.array(rampStepAction).optional(),
    // ISO datetime string. If set, the rule stays disabled until this date, then Step 1 fires.
    // Absent/null means start immediately when the schedule transitions to "ready".
    startDate: z.string().datetime().optional().nullable(),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
      })
      .optional(),
    // Optional: load and apply a template as defaults; explicit body fields take precedence.
    templateId: z.string().optional(),
  }),
};

/**
 * Returns true if the JSON type of `value` matches the feature's `valueType`.
 * Used to filter `force` values from templates that are incompatible.
 */
function forceMatchesValueType(
  value: unknown,
  valueType: FeatureInterface["valueType"],
): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  if (valueType === "boolean") return t === "boolean";
  if (valueType === "number") return t === "number";
  if (valueType === "string") return t === "string";
  if (valueType === "json") return t === "object";
  return false;
}

/**
 * Remaps template step actions to use the real targetId and ruleId,
 * and strips `force` values that don't match the feature's valueType.
 */
function remapTemplateActions(
  actions: RampScheduleTemplateInterface["steps"][number]["actions"],
  targetId: string,
  ruleId: string,
  valueType: FeatureInterface["valueType"],
): RampStepAction[] {
  return (actions ?? []).map((a) => {
    const patch = { ...a.patch, ruleId };
    if ("force" in patch && !forceMatchesValueType(patch.force, valueType)) {
      const { force: _force, ...rest } = patch;
      return { targetType: "feature-rule" as const, targetId, patch: rest };
    }
    return { targetType: "feature-rule" as const, targetId, patch };
  });
}

export const postRampSchedule = createApiRequestHandler(
  postRampScheduleValidator,
)(async (req) => {
  const body = req.body;

  // Verify the feature exists and the rule is live
  const feature = await getFeature(req.context, body.featureId);
  if (!feature) {
    throw new Error(`Feature '${body.featureId}' not found`);
  }
  const envRules = feature.environmentSettings?.[body.environment]?.rules ?? [];
  const rule = envRules.find((r) => r.id === body.ruleId);
  if (!rule) {
    throw new Error(
      `Rule '${body.ruleId}' not found in environment '${body.environment}'. ` +
        `The rule must be published before creating a ramp schedule via the REST API.`,
    );
  }

  // Enforce 1:1 — fail if a schedule already targets this rule in this environment
  const existing = await req.context.models.rampSchedules.getAllByFeatureId(
    body.featureId,
  );
  const alreadyAttached = existing.find((s) =>
    s.targets.some(
      (t) => t.ruleId === body.ruleId && t.environment === body.environment,
    ),
  );
  if (alreadyAttached) {
    throw new Error(
      `A ramp schedule (${alreadyAttached.id}) already exists for rule '${body.ruleId}' ` +
        `in environment '${body.environment}'. Delete it first before creating a new one.`,
    );
  }

  // Optionally load a template to use as defaults
  let template: RampScheduleTemplateInterface | undefined;
  if (body.templateId) {
    const tmpl = await req.context.models.rampScheduleTemplates.getById(
      body.templateId,
    );
    if (!tmpl) {
      throw new Error(`Template '${body.templateId}' not found`);
    }
    template = tmpl;
  }

  const targetId = uuidv4();

  const startDate = body.startDate ? new Date(body.startDate) : undefined;

  const resolvedSteps = body.steps
    ? body.steps
    : (template?.steps ?? []).map((s) => ({
        ...s,
        actions: remapTemplateActions(
          s.actions,
          targetId,
          body.ruleId,
          feature.valueType,
        ),
      }));

  // Resolve end condition from body or template
  const rawEndTrigger = body.endCondition?.trigger;
  const endTrigger = rawEndTrigger
    ? {
        type: "scheduled" as const,
        at: new Date((rawEndTrigger as { type: string; at: string | Date }).at),
      }
    : undefined;

  const endCondition = endTrigger ? { trigger: endTrigger } : undefined;

  if (!req.context.hasPremiumFeature("ramp-schedules")) {
    req.context.throwPlanDoesNotAllowError(
      "Ramp schedules require an Enterprise plan.",
    );
  }

  const schedule = await req.context.models.rampSchedules.create({
    name: body.name,
    entityType: "feature",
    entityId: body.featureId,
    targets: [
      {
        id: targetId,
        entityType: "feature",
        entityId: body.featureId,
        ruleId: body.ruleId,
        environment: body.environment,
        status: "active",
      },
    ],
    steps: resolvedSteps,
    endActions: body.endActions,
    startDate,
    endCondition,
    // Rule is already published — schedule is immediately eligible to start
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: startDate ?? null,
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  return { rampSchedule: schedule };
});
