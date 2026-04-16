import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { PermissionError } from "shared/util";
import { apiRampScheduleInterface } from "shared/validators";
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
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

const actionParamsSchema = z.object({ id: z.string() });

const attributionBodySchema = z.object({});

const rampScheduleResponse = z.object({
  rampSchedule: apiRampScheduleInterface,
});

// POST /ramp-schedules/:id/actions/start
export const startRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/start",
  operationId: "startRampSchedule",
  summary: "Start a ramp schedule",
  description:
    "Transitions the schedule from `ready` to `running` and processes the first\nstep immediately if eligible.\n",
  tags: ["ramp-schedules"],
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

  return { rampSchedule: rampScheduleToApiInterface(current) };
});

// POST /ramp-schedules/:id/actions/pause
export const pauseRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/pause",
  operationId: "pauseRampSchedule",
  summary: "Pause a ramp schedule",
  description:
    "Pauses a `running` or `pending-approval` schedule. The schedule can be\nresumed from the same position with the `/actions/resume` endpoint.\n",
  tags: ["ramp-schedules"],
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

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/resume
export const resumeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/resume",
  operationId: "resumeRampSchedule",
  summary: "Resume a paused ramp schedule",
  description:
    "Resumes a `paused` schedule. Adjusts timing anchors to account for the\npause duration so step intervals continue from where they left off.\n",
  tags: ["ramp-schedules"],
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
      // nextStepAt is null after a rollback: rebase phase timing from now.
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

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/jump
export const jumpRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: attributionBodySchema.extend({
    targetStepIndex: z
      .number()
      .int()
      .min(-1)
      .describe("Zero-based index of the step to jump to; -1 = pre-start"),
  }),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/jump",
  operationId: "jumpRampSchedule",
  summary: "Jump to a specific step",
  description:
    "Moves the schedule directly to `targetStepIndex` (forward or backward) and\npauses. Use `-1` to jump to the pre-start position without rolling back rule\npatches.\n",
  tags: ["ramp-schedules"],
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

  // phaseStartedAt = now - sum(intervals before target) so the next step fires at now + target.seconds
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

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/complete
export const completeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/complete",
  operationId: "completeRampSchedule",
  summary: "Complete a ramp schedule immediately",
  description:
    "Applies end actions and marks the schedule as `completed`, regardless of\nhow many steps remain.\n",
  tags: ["ramp-schedules"],
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

  return { rampSchedule: rampScheduleToApiInterface(completed) };
});

export const approveStepRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/approve-step",
  operationId: "approveStepRampSchedule",
  summary: "Approve the current pending-approval step",
  description:
    "Approves the current step on a schedule in `pending-approval` status and\nadvances to the next step. Requires the caller to have feature review\npermissions for the associated feature.\n",
  tags: ["ramp-schedules"],
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

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/rollback — lands in "paused" so it can be restarted
export const rollbackRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/rollback",
  operationId: "rollbackRampSchedule",
  summary: "Roll back a ramp schedule",
  description:
    "Rolls back to the starting position and lands in `paused` status so the\nschedule can be restarted with `/actions/start` or `/actions/resume`.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const isTerminal = ["completed", "rolled-back"].includes(schedule.status);
  const now = new Date();

  const rolled =
    schedule.currentStepIndex >= 0
      ? await rollbackToStep(req.context, schedule, -1)
      : schedule;

  const updated = await req.context.models.rampSchedules.updateById(rolled.id, {
    status: "paused",
    pausedAt: now,
    nextProcessAt: null,
    ...(isTerminal && { startedAt: null, phaseStartedAt: null }),
  });

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/add-target — enforces 1:1 [ruleId, environment] per schedule
export const addTargetRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    featureId: z.string(),
    ruleId: z.string(),
    environment: z.string(),
  }),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/add-target",
  operationId: "addTargetRampSchedule",
  summary: "Add a target rule to a ramp schedule",
  description:
    "Attaches an additional feature rule to this ramp schedule. The\n`[ruleId, environment]` pair must identify a rule that is already published\nand must not already be controlled by another schedule.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const { featureId, ruleId, environment } = req.body;

  const feature = await getFeature(req.context, featureId);
  if (!feature) throw new Error(`Feature '${featureId}' not found`);
  const envRules = feature.environmentSettings?.[environment]?.rules ?? [];
  if (!envRules.find((r) => r.id === ruleId)) {
    throw new Error(
      `Rule '${ruleId}' not found in environment '${environment}'. ` +
        `The rule must be published before attaching a ramp schedule.`,
    );
  }

  const conflicting = await req.context.models.rampSchedules.findByTargetRule(
    ruleId,
    environment,
  );
  const conflict = conflicting.find((s) => s.id !== schedule.id);
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

  // First target: set entityId for discoverability and transition pending → ready.
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

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

// POST /ramp-schedules/:id/actions/eject-target — deletes schedule if last target removed
export const ejectTargetRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z
    .object({
      targetId: z
        .string()
        .optional()
        .describe("Target ID (from the targets array)"),
      ruleId: z
        .string()
        .optional()
        .describe(
          "Rule ID — use with environment as an alternative to targetId",
        ),
      environment: z
        .string()
        .optional()
        .describe(
          "Environment — use with ruleId as an alternative to targetId",
        ),
    })
    .refine((b) => b.targetId || (b.ruleId && b.environment), {
      message: "Provide either targetId or both ruleId and environment",
    }),
  responseSchema: z
    .object({ rampSchedule: apiRampScheduleInterface })
    .or(z.object({ deleted: z.boolean(), rampScheduleId: z.string() })),
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/eject-target",
  operationId: "ejectTargetRampSchedule",
  summary: "Remove a target rule from a ramp schedule",
  description:
    "Detaches a target rule from this ramp schedule. Identify the target either\nby its `targetId` or by the `[ruleId, environment]` pair.\n\nIf this is the last target on the schedule, the schedule is deleted entirely\nand the response contains `deleted: true` instead of `rampSchedule`.\n",
  tags: ["ramp-schedules"],
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
    return { deleted: true, rampScheduleId: schedule.id };
  }

  const updated = await req.context.models.rampSchedules.updateById(
    schedule.id,
    { targets: remaining },
  );

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});
