import { z } from "zod";
import { rampControlledField, rampStep } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

const startTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
]);

const actionSchema = z.array(
  z.object({
    targetId: z.string(),
    patch: z.object({
      ruleId: z.string(),
      coverage: z.number().min(0).max(1).optional(),
      condition: z.string().optional(),
      force: z.unknown().optional(),
    }),
  }),
);

const putRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
  bodySchema: z.object({
    name: z.string().optional(),
    steps: z.array(rampStep).min(0).optional(),
    controlledFields: z.array(rampControlledField.exclude(["enabled"])).optional(),
    startCondition: z
      .object({
        trigger: startTriggerSchema.optional(),
        actions: actionSchema.optional(),
      })
      .optional()
      .nullable(),
    disableRuleBefore: z.boolean().optional(),
    disableRuleAfter: z.boolean().optional(),
    endEarlyWhenStepsComplete: z.boolean().optional(),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
        actions: actionSchema.optional(),
      })
      .optional()
      .nullable(),
  }),
};

export const putRampSchedule = createApiRequestHandler(
  putRampScheduleValidator,
)(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) {
    throw new Error("Ramp schedule not found");
  }

  // Only allow updates when the schedule has not yet started or is paused between steps
  if (!["pending", "ready", "paused"].includes(schedule.status)) {
    throw new Error(
      `Cannot update ramp schedule in status "${schedule.status}". Only pending, ready, or paused schedules can be modified.`,
    );
  }

  const updates: Record<string, unknown> = {};
  const body = req.body;

  if (body.name !== undefined) updates.name = body.name;
  if (body.steps !== undefined) updates.steps = body.steps;
  if (body.controlledFields !== undefined) {
    updates.targets = schedule.targets.map((t) => ({
      ...t,
      controlledFields: body.controlledFields,
    }));
  }
  if (body.startCondition !== undefined) {
    const sc = body.startCondition;
    if (!sc) {
      updates.startCondition = { trigger: { type: "immediately" } };
    } else {
      const rawTrigger = sc.trigger;
      const trigger =
        rawTrigger?.type === "scheduled"
          ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
          : (rawTrigger ?? { type: "immediately" as const });
      updates.startCondition = { trigger, actions: sc.actions ?? undefined };
    }
  }
  if (body.disableRuleBefore !== undefined) {
    updates.disableRuleBefore = body.disableRuleBefore;
  }
  if (body.disableRuleAfter !== undefined) {
    updates.disableRuleAfter = body.disableRuleAfter;
  }
  if (body.endEarlyWhenStepsComplete !== undefined) {
    updates.endEarlyWhenStepsComplete = body.endEarlyWhenStepsComplete;
  }
  if (body.endCondition !== undefined) {
    const ec = body.endCondition;
    if (!ec) {
      updates.endCondition = undefined;
    } else {
      const rawTrigger = ec.trigger;
      const trigger = rawTrigger
        ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
        : undefined;
      updates.endCondition = { trigger, actions: ec.actions ?? undefined };
    }
  }

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );

  return { rampSchedule: updated };
});
