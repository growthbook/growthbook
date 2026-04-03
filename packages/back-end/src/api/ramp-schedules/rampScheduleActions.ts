import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { PermissionError } from "shared/util";
import {
  advanceUntilBlocked,
  approveAndPublishStep,
  applyRampStartActions,
  completeRollout,
  computeNextProcessAt,
  computeNextStepAt,
  dispatchRampEvent,
  jumpAheadToStep,
  rollbackToStep,
} from "back-end/src/services/rampSchedule";
import { getFeature } from "back-end/src/models/FeatureModel";
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
    nextProcessAt: computeNextProcessAt({
      status: "running",
      nextStepAt: initialNextStepAt,
      endCondition: schedule.endCondition,
    }),
  });

  await applyRampStartActions(req.context, current);
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
    { status: "paused", pausedAt: new Date(), nextProcessAt: null },
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
      // Shift existing deadline forward by the pause duration.
      resumeUpdates.nextStepAt = new Date(
        schedule.nextStepAt.getTime() + pauseDurationMs,
      );
    } else {
      // nextStepAt is null (after a rollback or reset).
      // At start (-1): fire step 0 immediately.
      // Mid-schedule: rebase phaseStartedAt and recompute next step timer from now.
      const nextStepIndex = schedule.currentStepIndex + 1;
      if (schedule.currentStepIndex === -1) {
        resumeUpdates.nextStepAt = schedule.steps.length > 0 ? now : null;
      } else if (nextStepIndex < schedule.steps.length) {
        const currentStepIndex = schedule.currentStepIndex;
        let sumBefore = 0;
        for (let i = 0; i < currentStepIndex; i++) {
          const t = schedule.steps[i]?.trigger;
          if (t?.type === "interval") sumBefore += t.seconds;
        }
        const freshPhaseStart = new Date(now.getTime() - sumBefore * 1000);
        resumeUpdates.phaseStartedAt = freshPhaseStart;
        resumeUpdates.nextStepAt = computeNextStepAt(
          { ...schedule, phaseStartedAt: freshPhaseStart },
          currentStepIndex,
          now,
        );
      }
    }
  }

  resumeUpdates.nextProcessAt = computeNextProcessAt({
    status: resumeUpdates.status as "running" | "pending-approval",
    nextStepAt: resumeUpdates.nextStepAt as Date | null | undefined,
    endCondition: schedule.endCondition,
    startDate: schedule.startDate,
  });

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

  // Rebase phaseStartedAt so the landed step's hold timer runs from "now".
  // phaseStartedAt = now - sum(interval[0..target-1]) means the next step fires
  // at now + steps[target].seconds, which is the expected behavior after landing.
  const freshPhaseStartedAt = (() => {
    if (targetStepIndex <= 0) return now;
    let elapsed = 0;
    for (let i = 0; i < targetStepIndex; i++) {
      const t = schedule.steps[i]?.trigger;
      if (t?.type === "interval") elapsed += t.seconds;
    }
    return new Date(now.getTime() - elapsed * 1000);
  })();

  let updated;
  if (targetStepIndex < schedule.currentStepIndex) {
    const rolled = await rollbackToStep(req.context, schedule, targetStepIndex);
    updated = await req.context.models.rampSchedules.updateById(rolled.id, {
      status: "paused",
      pausedAt: now,
      phaseStartedAt: freshPhaseStartedAt,
      nextStepAt: null,
      nextProcessAt: null,
    });
  } else if (targetStepIndex > schedule.currentStepIndex) {
    updated = await jumpAheadToStep(req.context, schedule, targetStepIndex);
  } else {
    updated = await req.context.models.rampSchedules.updateById(schedule.id, {
      status: "paused",
      pausedAt: now,
      phaseStartedAt: freshPhaseStartedAt,
      nextStepAt: null,
      nextProcessAt: null,
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

// POST /ramp-schedules/:id/actions/approve-step
// Approve the current pending-approval gate and advance to the next step.
export const approveStepRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (schedule.status !== "pending-approval") {
    throw new Error(
      `Cannot approve step: schedule is not in "pending-approval" status (currently "${schedule.status}")`,
    );
  }

  const err = await approveAndPublishStep(req.context, schedule);
  if (err) {
    const detail = "detail" in err ? err.detail : undefined;
    if (err.code === "permission_denied") {
      throw new PermissionError(`Permission denied: ${detail ?? err.code}`);
    }
    throw new Error(detail ?? err.code);
  }

  const updated =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? schedule;

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/rollback
// Roll back to the very beginning (-1) and land in "paused" so the schedule
// can be restarted via /actions/start or /actions/resume.
export const rollbackRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema,
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const isTerminal = ["completed", "rolled-back"].includes(schedule.status);
  const now = new Date();

  // Roll back rule patches if the schedule has progressed past step 0.
  const rolled =
    schedule.currentStepIndex >= 0
      ? await rollbackToStep(req.context, schedule, -1)
      : schedule;

  // Override the terminal "rolled-back" status to "paused" so it can be restarted.
  // Note: rollbackToStep already dispatches rampSchedule.actions.rolledBack above,
  // so we skip a second dispatch here to avoid duplicate audit entries.
  const updated = await req.context.models.rampSchedules.updateById(rolled.id, {
    status: "paused",
    pausedAt: now,
    nextProcessAt: null,
    // Clear timing anchors for terminal restarts so resume begins fresh.
    ...(isTerminal && { startedAt: null, phaseStartedAt: null }),
  });

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/add-target
// Attach an additional feature rule to this ramp schedule as a new target.
// Enforces the 1:1 constraint: each [featureId, ruleId, environment] combo
// can only be controlled by one schedule at a time.
export const addTargetRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    featureId: z.string(),
    ruleId: z.string(),
    environment: z.string(),
  }),
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const { featureId, ruleId, environment } = req.body;

  // Verify the feature and rule exist.
  const feature = await getFeature(req.context, featureId);
  if (!feature) throw new Error(`Feature '${featureId}' not found`);
  const envRules = feature.environmentSettings?.[environment]?.rules ?? [];
  if (!envRules.find((r) => r.id === ruleId)) {
    throw new Error(
      `Rule '${ruleId}' not found in environment '${environment}'. ` +
        `The rule must be published before attaching a ramp schedule.`,
    );
  }

  // Enforce 1:1 across all schedules for this feature.
  // Also check target-less schedules (entityId: "") since they may already
  // carry a conflicting target from a previous add-target call.
  const [featureSchedules, untargetedSchedules] = await Promise.all([
    req.context.models.rampSchedules.getAllByFeatureId(featureId),
    schedule.entityId === ""
      ? req.context.models.rampSchedules.getAllByEntityId("feature", "")
      : Promise.resolve([] as (typeof schedule)[]),
  ]);
  const allSchedules = [
    ...featureSchedules.filter((s) => s.id !== schedule.id),
    ...untargetedSchedules.filter((s) => s.id !== schedule.id),
  ];
  const conflict = allSchedules.find((s) =>
    s.targets.some((t) => t.ruleId === ruleId && t.environment === environment),
  );
  if (conflict) {
    throw new Error(
      `Schedule '${conflict.id}' already controls rule '${ruleId}' in environment '${environment}'.`,
    );
  }

  const newTarget = {
    id: uuidv4(),
    entityType: "feature" as const,
    entityId: featureId,
    ruleId,
    environment,
    status: "active" as const,
  };

  // When adding the first target to a targetless schedule:
  // - set entityId so it's discoverable via getAllByFeatureId
  // - transition pending → ready so the schedule can be started
  const isFirstTarget = schedule.targets.length === 0;
  const entityUpdate = schedule.entityId === "" ? { entityId: featureId } : {};
  const statusUpdate =
    isFirstTarget && schedule.status === "pending"
      ? { status: "ready" as const }
      : {};

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    {
      targets: [...schedule.targets, newTarget],
      ...entityUpdate,
      ...statusUpdate,
    },
  );

  return { rampSchedule: updated };
});

// POST /ramp-schedules/:id/actions/eject-target
// Remove a target from this schedule. The target may be identified by its
// `targetId`, or by the `[ruleId, environment]` pair. If removing this target
// would leave the schedule with no targets, the schedule is deleted entirely.
export const ejectTargetRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z
    .object({
      targetId: z.string().optional(),
      ruleId: z.string().optional(),
      environment: z.string().optional(),
    })
    .refine((b) => b.targetId || (b.ruleId && b.environment), {
      message: "Provide either targetId or both ruleId and environment",
    }),
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const { targetId, ruleId, environment } = req.body;

  const remaining = schedule.targets.filter((t) => {
    if (targetId) return t.id !== targetId;
    return !(t.ruleId === ruleId && t.environment === environment);
  });

  if (remaining.length === schedule.targets.length) {
    throw new Error("No matching target found on this schedule");
  }

  if (remaining.length === 0) {
    await req.context.models.rampSchedules.deleteById(schedule.id);
    return { deletedId: schedule.id };
  }

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    { targets: remaining },
  );

  return { rampSchedule: updated };
});
