import { z } from "zod";
import {
  rampStep,
  rampStepAction,
  RampScheduleInterface,
  RampStepAction,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { computeNextProcessAt } from "back-end/src/services/rampSchedule";

// Step action where targetId is optional — when omitted (or "t1"), it is
// resolved to the schedule's single active target at request time.
const putBodyAction = rampStepAction
  .omit({ targetId: true })
  .extend({ targetId: z.string().optional() });

const putBodyStep = rampStep
  .omit({ actions: true })
  .extend({ actions: z.array(putBodyAction) });

const putRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
  bodySchema: z.object({
    name: z.string().optional(),
    steps: z.array(putBodyStep).min(0).optional(),
    endActions: z.array(putBodyAction).optional(),
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

  // Enterprise gate — see postRampSchedule.ts for rationale.
  if (!req.context.hasPremiumFeature("ramp-schedules")) {
    req.context.throwPlanDoesNotAllowError(
      "Ramp schedules require an Enterprise plan.",
    );
  }

  // Only allow updates when the schedule has not yet started or is paused between steps
  if (!["pending", "ready", "paused"].includes(schedule.status)) {
    throw new Error(
      `Cannot update ramp schedule in status "${schedule.status}". Only pending, ready, or paused schedules can be modified.`,
    );
  }

  const updates: Record<string, unknown> = {};
  const body = req.body;

  // Resolve omitted / "t1" targetId placeholders to the schedule's active target UUID.
  const resolveTargetId = (
    action: z.infer<typeof putBodyAction>,
  ): RampStepAction => {
    const tid = action.targetId;
    if (tid && tid !== "t1") {
      // Validate that the explicitly supplied targetId actually exists on this schedule.
      if (!schedule.targets.some((t) => t.id === tid)) {
        throw new Error(
          `targetId '${tid}' does not exist on this ramp schedule. Use the id from schedule.targets[].id.`,
        );
      }
      return action as RampStepAction;
    }
    const activeTargets = schedule.targets.filter((t) => t.status === "active");
    if (activeTargets.length === 0) {
      throw new Error("Ramp schedule has no active targets.");
    }
    if (activeTargets.length > 1) {
      throw new Error(
        `Ramp schedule has ${activeTargets.length} active targets. Specify targetId explicitly in each action.`,
      );
    }
    return { ...action, targetId: activeTargets[0].id } as RampStepAction;
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.steps !== undefined) {
    updates.steps = body.steps.map((step) => ({
      ...step,
      actions: step.actions.map(resolveTargetId),
    }));
  }
  if (body.endActions !== undefined) {
    updates.endActions = body.endActions.map(resolveTargetId);
  }
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
