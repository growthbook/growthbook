import { z } from "zod";
import {
  advanceStep,
  advanceUntilBlocked,
  applyStartConditionActions,
  completeRollout,
  dispatchRampEvent,
  jumpAheadToStep,
  rollbackToStep,
} from "back-end/src/services/rampSchedule";
import { createApiRequestHandler } from "back-end/src/util/handler";

const actionParamsSchema = z.object({ id: z.string() });

const attributionBodySchema = z.object({});

// POST /ramp-schedules/:id/actions/start
export const startRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (schedule.status !== "ready") {
    throw new Error(
      `Cannot start a ramp schedule in status "${schedule.status}" — must be "ready"`,
    );
  }

  const now = new Date();
  const initialNextStepAt = schedule.steps.length > 0 ? now : null;
  let current = await req.context.models.rampSchedules.updateById(schedule.id, {
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    nextStepAt: initialNextStepAt,
  });

  await applyStartConditionActions(req.context, current);
  await advanceUntilBlocked(req.context, current, now);
  current =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? current;

  await dispatchRampEvent(
    req.context,
    current,
    "rampSchedule.actions.started",
    {
      object: {
        rampScheduleId: current.id,
        rampName: current.name,
        orgId: req.context.org.id,
        currentStepIndex: current.currentStepIndex,
        status: current.status,
      },
    },
  );

  return { rampSchedule: current };
});

// POST /ramp-schedules/:id/actions/pause
export const pauseRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (!["running", "pending-approval"].includes(schedule.status)) {
    throw new Error(
      `Cannot pause a ramp schedule in status "${schedule.status}"`,
    );
  }

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    { status: "paused", pausedAt: new Date() },
  );

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/resume
// Note: delegates to the internal controller logic via the same service functions.
export const resumeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (schedule.status !== "paused") {
    throw new Error(
      `Cannot resume a ramp schedule in status "${schedule.status}"`,
    );
  }

  const now = new Date();
  const pauseDurationMs = schedule.pausedAt
    ? now.getTime() - schedule.pausedAt.getTime()
    : 0;
  const newStartedAt = schedule.startedAt ?? now;
  const newPhaseStartedAt = schedule.phaseStartedAt
    ? new Date(schedule.phaseStartedAt.getTime() + Math.max(0, pauseDurationMs))
    : now;

  const currentStep = schedule.steps[schedule.currentStepIndex];
  const pausedAtApproval = currentStep?.trigger?.type === "approval";

  const resumeUpdates: Record<string, unknown> = {
    status: pausedAtApproval ? "pending-approval" : "running",
    pausedAt: null,
    startedAt: newStartedAt,
    phaseStartedAt: newPhaseStartedAt,
    nextStepAt: pausedAtApproval ? null : schedule.nextStepAt,
  };

  if (!pausedAtApproval) {
    if (schedule.nextStepAt) {
      resumeUpdates.nextStepAt = new Date(
        schedule.nextStepAt.getTime() + pauseDurationMs,
      );
    } else {
      if (schedule.currentStepIndex === -1) {
        resumeUpdates.nextStepAt = schedule.steps.length > 0 ? now : null;
      }
    }
  }

  let updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    resumeUpdates,
  );
  if (!pausedAtApproval) {
    await advanceUntilBlocked(req.context, updated, now);
    updated =
      (await req.context.models.rampSchedules.getById(schedule.id)) ?? updated;
  }

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/advance
export const advanceRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (!["running", "paused"].includes(schedule.status)) {
    throw new Error(
      `Cannot manually advance a ramp schedule in status "${schedule.status}"`,
    );
  }

  const advanced = await advanceStep(req.context, schedule);

  return { rampSchedule: advanced };
});

// POST /ramp-schedules/:id/actions/rollback
// Always rolls back to the very beginning (-1). Use /actions/jump to land at a specific step.
export const rollbackRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const rolledBack = await rollbackToStep(req.context, schedule, -1);

  return { rampSchedule: rolledBack };
});

// POST /ramp-schedules/:id/actions/jump
// Jump to an exact step index (forward or backward). Pauses after landing.
export const jumpRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema.extend({
    targetStepIndex: z.number().int().min(-1),
  }),
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (["completed", "rolled-back"].includes(schedule.status)) {
    throw new Error(
      `Cannot jump a schedule in terminal status "${schedule.status}"`,
    );
  }

  const { targetStepIndex } = req.body;
  if (targetStepIndex < -1 || targetStepIndex >= schedule.steps.length) {
    throw new Error(`Invalid targetStepIndex ${targetStepIndex}`);
  }

  const now = new Date();

  let updated;
  if (targetStepIndex < schedule.currentStepIndex) {
    updated = await rollbackToStep(req.context, schedule, targetStepIndex);
  } else if (targetStepIndex > schedule.currentStepIndex) {
    updated = await jumpAheadToStep(req.context, schedule, targetStepIndex);
  } else {
    updated = await req.context.models.rampSchedules.updateById(schedule.id, {
      status: "paused",
      pausedAt: now,
      nextStepAt: null,
    });
  }

  await dispatchRampEvent(req.context, updated, "rampSchedule.actions.jumped", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: req.context.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      targetStepIndex,
    },
  });

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/complete
// "Complete rollout" — jumps to last step or applies endCondition immediately
export const completeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (["completed", "rolled-back"].includes(schedule.status)) {
    throw new Error(
      `Ramp schedule is already in terminal status "${schedule.status}"`,
    );
  }

  const completed = await completeRollout(req.context, schedule);

  return { rampSchedule: completed };
});
