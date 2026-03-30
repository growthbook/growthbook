import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  rampControlledField,
  rampStep,
  RampScheduleInterface,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";

const startTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
]);

const postRampScheduleValidator = {
  bodySchema: z.object({
    name: z.string(),
    // The feature and rule this schedule controls.
    // The rule must already be live (published) before creating a schedule via REST.
    featureId: z.string(),
    ruleId: z.string(),
    environment: z.string(),
    steps: z.array(rampStep).min(0),
    controlledFields: z.array(rampControlledField.exclude(["enabled"])),
    startCondition: z.object({ trigger: startTriggerSchema }).optional(),
    disableRuleBefore: z.boolean().optional(),
    disableRuleAfter: z.boolean().optional(),
    endEarlyWhenStepsComplete: z.boolean().optional(),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
      })
      .optional(),
  }),
};

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

  const rawStartTrigger = body.startCondition?.trigger;
  const startTrigger =
    rawStartTrigger?.type === "scheduled"
      ? { type: "scheduled" as const, at: new Date(rawStartTrigger.at) }
      : (rawStartTrigger ?? { type: "immediately" as const });

  const rawEndTrigger = body.endCondition?.trigger;
  const endTrigger = rawEndTrigger
    ? { type: "scheduled" as const, at: new Date(rawEndTrigger.at) }
    : undefined;

  const targetId = uuidv4();
  const enabledPatch = { ruleId: body.ruleId, enabled: true as const };
  const disabledPatch = { ruleId: body.ruleId, enabled: false as const };

  const startActions = body.disableRuleBefore
    ? [{ targetType: "feature-rule" as const, targetId, patch: enabledPatch }]
    : undefined;
  const endActions = body.disableRuleAfter
    ? [{ targetType: "feature-rule" as const, targetId, patch: disabledPatch }]
    : undefined;
  const endCondition =
    endTrigger || endActions
      ? { trigger: endTrigger, actions: endActions }
      : undefined;

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
        controlledFields: body.controlledFields,
      },
    ],
    steps: body.steps,
    startCondition: { trigger: startTrigger, actions: startActions },
    disableRuleBefore: body.disableRuleBefore,
    disableRuleAfter: body.disableRuleAfter,
    endEarlyWhenStepsComplete: body.endEarlyWhenStepsComplete,
    endCondition,
    // Rule is already published — schedule is immediately eligible to start
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  return { rampSchedule: schedule };
});
