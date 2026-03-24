import { z } from "zod";
import {
  advanceStep,
  completeRollout,
  makeAttribution,
  rollbackToStep,
} from "back-end/src/services/rampSchedule";
import { createApiRequestHandler } from "back-end/src/util/handler";

const actionParamsSchema = z.object({ id: z.string() });

const attributionBodySchema = z.object({
  reason: z.string().optional(),
  source: z.string().optional(),
});

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
  const started = await req.context.models.rampSchedules.updateById(
    schedule.id,
    { status: "running", startedAt: now, phaseStartedAt: now },
  );

  const advanced = await advanceStep(
    req.context,
    started,
    makeAttribution(
      req.context.userId || undefined,
      req.body.reason,
      req.body.source,
    ),
  );

  return { rampSchedule: advanced };
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
  const resumeUpdates: Record<string, unknown> = { status: "running" };
  if (pauseDurationMs > 0) {
    if (schedule.phaseStartedAt) {
      resumeUpdates.phaseStartedAt = new Date(
        schedule.phaseStartedAt.getTime() + pauseDurationMs,
      );
    }
    if (schedule.nextStepAt) {
      resumeUpdates.nextStepAt = new Date(
        schedule.nextStepAt.getTime() + pauseDurationMs,
      );
    }
  }
  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    resumeUpdates,
  );

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

  const advanced = await advanceStep(
    req.context,
    schedule,
    makeAttribution(
      req.context.userId || undefined,
      req.body.reason,
      req.body.source,
    ),
  );

  return { rampSchedule: advanced };
});

// POST /ramp-schedules/:id/actions/rollback
export const rollbackRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema.extend({
    targetStepIndex: z.number().int().min(-1).optional(),
  }),
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  // -1 = full rollback (to before step 0); default to full rollback
  const targetStepIndex = req.body.targetStepIndex ?? -1;

  const rolledBack = await rollbackToStep(
    req.context,
    schedule,
    targetStepIndex,
    makeAttribution(
      req.context.userId || undefined,
      req.body.reason,
      req.body.source,
    ),
  );

  return { rampSchedule: rolledBack };
});

// POST /ramp-schedules/:id/actions/complete
// "Complete rollout" — jumps to last step or applies endSchedule immediately
export const completeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (["completed", "expired", "rolled-back"].includes(schedule.status)) {
    throw new Error(
      `Ramp schedule is already in terminal status "${schedule.status}"`,
    );
  }

  const completed = await completeRollout(
    req.context,
    schedule,
    makeAttribution(
      req.context.userId || undefined,
      req.body.reason,
      req.body.source,
    ),
  );

  return { rampSchedule: completed };
});
