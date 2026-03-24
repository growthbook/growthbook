import { z } from "zod";
import { rampStep, rampStepAction } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

const startTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
]);

const endScheduleSchema = z.object({
  trigger: z.object({
    type: z.literal("scheduled"),
    at: z.string().datetime(),
  }),
  actions: z.array(
    z.object({
      targetId: z.string(),
      patch: z.object({
        ruleId: z.string(),
        coverage: z.number().min(0).max(1).optional(),
        condition: z.string().optional(),
        force: z.unknown().optional(),
      }),
    }),
  ),
});

const putRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
  bodySchema: z.object({
    name: z.string().optional(),
    steps: z.array(rampStep).min(0).optional(),
    autoRollback: z
      .object({ enabled: z.boolean(), criteriaId: z.string() })
      .optional(),
    startTrigger: startTriggerSchema.optional().nullable(),
    startActions: z.array(rampStepAction).optional().nullable(),
    disableOutsideSchedule: z.boolean().optional().nullable(),
    endSchedule: endScheduleSchema.optional().nullable(),
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
  if (body.autoRollback !== undefined) updates.autoRollback = body.autoRollback;
  if (body.startTrigger !== undefined) {
    const st = body.startTrigger;
    updates.startTrigger = st
      ? st.type === "scheduled"
        ? { type: "scheduled", at: new Date(st.at) }
        : st
      : undefined;
  }
  if (body.startActions !== undefined) {
    updates.startActions = body.startActions ?? undefined;
  }
  if (body.disableOutsideSchedule !== undefined) {
    updates.disableOutsideSchedule = body.disableOutsideSchedule ?? undefined;
  }
  if (body.endSchedule !== undefined) {
    updates.endSchedule = body.endSchedule
      ? {
          trigger: {
            type: "scheduled",
            at: new Date(body.endSchedule.trigger.at),
          },
          actions: body.endSchedule.actions,
        }
      : undefined;
  }

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );

  return { rampSchedule: updated };
});
