import { z } from "zod";
import {
  rampStep,
  rampStepAction,
  RampScheduleInterface,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { computeNextProcessAt } from "back-end/src/services/rampSchedule";

const putRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
  bodySchema: z.object({
    name: z.string().optional(),
    steps: z.array(rampStep).min(0).optional(),
    endActions: z.array(rampStepAction).optional(),
    // ISO datetime string; null clears startDate (immediate start).
    startDate: z.string().datetime().optional().nullable(),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
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
  if (body.endActions !== undefined) updates.endActions = body.endActions;
  if ("startDate" in body) {
    updates.startDate = body.startDate ? new Date(body.startDate) : null;
  }
  if (body.endCondition !== undefined) {
    const ec = body.endCondition;
    if (!ec) {
      updates.endCondition = null;
    } else {
      const rawTrigger = ec.trigger;
      const trigger = rawTrigger
        ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
        : undefined;
      updates.endCondition = { trigger };
    }
  }

  updates.nextProcessAt = computeNextProcessAt({
    status: schedule.status,
    nextStepAt: schedule.nextStepAt,
    endCondition: ("endCondition" in updates
      ? updates.endCondition
      : schedule.endCondition) as RampScheduleInterface["endCondition"],
    startDate: ("startDate" in updates
      ? updates.startDate
      : schedule.startDate) as RampScheduleInterface["startDate"],
  });

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );

  return { rampSchedule: updated };
});
