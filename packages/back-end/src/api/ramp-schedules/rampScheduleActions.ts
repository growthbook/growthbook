import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { PermissionError } from "shared/util";
import { apiRampScheduleInterface } from "shared/validators";
import {
  advanceScheduleManually,
  approveAndPublishStep,
  completeRollout,
  getEffectiveRampAutoUpdateState,
  getRampMonitoringMode,
  jumpSchedule,
  pauseSchedule,
  rollbackSchedule,
  restartSchedule,
  resumeSchedule,
  setRampMonitoringMode,
  startSchedule,
} from "back-end/src/services/rampSchedule";
import { getFeature } from "back-end/src/models/FeatureModel";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  rampTargetsEquivalent,
  resolveRampTarget,
} from "back-end/src/util/flattenRules";

const actionParamsSchema = z.object({ id: z.string() });

const attributionBodySchema = z.object({});

const rampScheduleResponse = z.object({
  rampSchedule: apiRampScheduleInterface,
});

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

  const current = await startSchedule(req.context, schedule);
  return { rampSchedule: rampScheduleToApiInterface(current) };
});

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

  const updated = await pauseSchedule(req.context, schedule);

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

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

  const updated = await resumeSchedule(req.context, schedule);

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

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

  const updated = await jumpSchedule(req.context, schedule, targetStepIndex);

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

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

const rollbackBodySchema = z
  .object({
    reason: z.string().max(200).optional(),
  })
  .strict();

export const rollbackRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: rollbackBodySchema,
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/rollback",
  operationId: "rollbackRampSchedule",
  summary: "Roll back a ramp schedule",
  description:
    "Rewinds all ramp effects (rule coverage, targeting, etc.) to the starting\nposition and lands in terminal `rolled-back` status. The reason is persisted\nas `lastRollbackReason` (prefixed with `Manual: `) and surfaced in the UI.\n\nFrom this terminal state the schedule can be brought back to `ready` via\n`/actions/restart`, after which `/actions/start` will run it again.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (["completed", "rolled-back"].includes(schedule.status)) {
    throw new Error(
      `Schedule is already in terminal status "${schedule.status}"`,
    );
  }

  const cause = req.body.reason?.trim();
  const reason = cause ? `Manual: ${cause}` : "Manual";
  const updated = await rollbackSchedule(req.context, schedule, reason);

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

export const restartRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/restart",
  operationId: "restartRampSchedule",
  summary: "Restart a terminal ramp schedule",
  description:
    "Brings a `rolled-back` (or `completed`) schedule back into `running` in a\nsingle call. Any prior start-on-date delays are cleared (`startedAt`,\n`phaseStartedAt`, etc. are reset), `currentStepIndex` is normalised to\n`-1`, then the same logic as `/actions/start` runs to apply start actions\nand advance through immediately-eligible steps.\n\nThe rollback that preceded this already rewound rule effects to the\nstarting position; this endpoint does **not** re-execute that rewind for\n`rolled-back` schedules. `completed` schedules are defensively rewound\nfirst.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (!["rolled-back", "completed"].includes(schedule.status)) {
    throw new Error(
      `Cannot restart a schedule in status "${schedule.status}". Only terminal (rolled-back / completed) schedules can be restarted.`,
    );
  }

  const updated = await restartSchedule(req.context, schedule);
  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

export const addTargetRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    featureId: z.string(),
    ruleId: z.string(),
    environment: z
      .string()
      .optional()
      .meta({ deprecated: true })
      .describe(
        "Deprecated pre-v2 disambiguator; ignored on v2 rules where `rule.id` is uniquely sufficient.",
      ),
  }),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/add-target",
  operationId: "addTargetRampSchedule",
  summary: "Add a target rule to a ramp schedule",
  description:
    "Attaches an additional feature rule to this ramp schedule. The `ruleId`\nmust identify a rule that is already published and must not already be\ncontrolled by another schedule. `environment` is accepted for backward\ncompatibility with pre-v2 ramps but is deprecated and no longer required.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const { featureId, ruleId, environment } = req.body;
  const envSuffix = environment ? ` in environment '${environment}'` : "";

  const feature = await getFeature(req.context, featureId);
  if (!feature) throw new Error(`Feature '${featureId}' not found`);
  const rule = resolveRampTarget(
    { ruleId, environment: environment ?? null },
    feature.rules ?? [],
  );
  if (!rule) {
    throw new Error(
      `Rule '${ruleId}' not found${envSuffix}. ` +
        `The rule must be published before attaching a ramp schedule.`,
    );
  }

  const conflicting = await req.context.models.rampSchedules.findByTargetRule(
    ruleId,
    environment ?? undefined,
  );
  const conflict = conflicting.find((s) => s.id !== schedule.id);
  if (conflict) {
    throw new Error(
      `Schedule '${conflict.id}' already controls rule '${ruleId}'${envSuffix}.`,
    );
  }

  const newTarget = {
    id: uuidv4(),
    entityType: "feature" as const,
    entityId: featureId,
    ruleId,
    status: "active" as const,
  };

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
        .describe("Rule ID — use as an alternative to targetId"),
      environment: z
        .string()
        .optional()
        .meta({ deprecated: true })
        .describe(
          "Deprecated pre-v2 disambiguator. Optional when used with ruleId; omit on v2 ramps.",
        ),
    })
    .refine((b) => b.targetId || b.ruleId, {
      message: "Provide either targetId or ruleId",
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
    return !rampTargetsEquivalent(t, {
      ruleId,
      environment: environment ?? null,
    });
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

export const apiAdvanceRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z
    .object({
      reason: z.string().optional().describe("Reason for advancing"),
    })
    .optional(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/advance",
  operationId: "apiAdvanceRampSchedule",
  summary: "API-driven step advancement",
  description:
    "Advances the schedule to the next step. Use this for external system integrations (e.g. DataDog, CI pipelines).",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  if (!["running", "paused"].includes(schedule.status)) {
    throw new Error(`Cannot advance a schedule in status "${schedule.status}"`);
  }

  let current = await advanceScheduleManually(req.context, schedule);
  current =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? current;

  return { rampSchedule: rampScheduleToApiInterface(current) };
});

export const getRampScheduleStatus = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: z.object({
    id: z.string(),
    status: z.string(),
    currentStepIndex: z.number(),
    totalSteps: z.number(),
    lockdownMode: z.string().optional(),
    startedAt: z.string().nullable().optional(),
    lastRollbackAt: z.string().nullable().optional(),
    lastRollbackReason: z.string().nullable().optional(),
    monitoring: z
      .object({
        enabled: z.boolean(),
        monitoringMode: z.enum(["auto", "manual"]),
        autoUpdate: z.boolean(),
        effectiveAutoUpdate: z.boolean(),
        blockedReason: z.string().nullable().optional(),
        currentStepMonitored: z.boolean(),
        nextSnapshotAt: z.string().nullable().optional(),
        safeRolloutId: z.string().nullable().optional(),
      })
      .optional(),
  }),
  method: "get" as const,
  path: "/ramp-schedules/:id/status",
  operationId: "getRampScheduleStatus",
  summary: "Get ramp schedule status summary",
  description:
    "Returns a derived status summary of the ramp schedule, suitable\nfor monitoring dashboards and CI pipeline integrations.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const monitoring = schedule.monitoringConfig
    ? (() => {
        const autoUpdateState = getEffectiveRampAutoUpdateState(schedule);
        const monitoringMode = getRampMonitoringMode(schedule.monitoringConfig);
        return {
          enabled: true,
          monitoringMode,
          autoUpdate: monitoringMode === "auto",
          effectiveAutoUpdate: autoUpdateState.enabled,
          blockedReason: autoUpdateState.reason,
          currentStepMonitored:
            schedule.currentStepIndex >= 0 &&
            !!schedule.steps[schedule.currentStepIndex]?.monitored,
          nextSnapshotAt: schedule.nextSnapshotAt?.toISOString() ?? null,
          safeRolloutId: schedule.safeRolloutId ?? null,
        };
      })()
    : undefined;

  return {
    id: schedule.id,
    status: schedule.status,
    currentStepIndex: schedule.currentStepIndex,
    totalSteps: schedule.steps.length,
    lockdownMode: schedule.lockdownConfig?.mode,
    startedAt: schedule.startedAt?.toISOString() ?? null,
    lastRollbackAt: schedule.lastRollbackAt?.toISOString() ?? null,
    lastRollbackReason: schedule.lastRollbackReason ?? null,
    monitoring,
  };
});

export const setMonitoringModeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    monitoringMode: z
      .enum(["auto", "manual"])
      .describe(
        "`auto` schedules snapshots automatically while allowed by ramp state. `manual` disables agenda updates and relies on manual Update clicks.",
      ),
  }),
  responseSchema: apiRampScheduleInterface,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/set-monitoring-mode",
  operationId: "setMonitoringModeRampSchedule",
  summary: "Set ramp monitoring mode",
  description:
    "Sets the user preference for ramp monitoring updates. In `manual` mode, automatic snapshot scheduling is disabled and operators must click Update manually. In `auto` mode, snapshots run automatically when the current step is monitored and the ramp is running.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  const updated = await setRampMonitoringMode(
    req.context,
    schedule,
    req.body.monitoringMode,
  );
  return rampScheduleToApiInterface(updated);
});

export const setAutoUpdateRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    enabled: z
      .boolean()
      .describe(
        "Legacy alias for monitoring mode (`true` => auto, `false` => manual).",
      ),
  }),
  responseSchema: apiRampScheduleInterface,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/set-auto-update",
  operationId: "setAutoUpdateRampSchedule",
  summary: "Toggle automatic monitoring updates",
  description:
    "Deprecated alias for setting monitoring mode. Prefer `/actions/set-monitoring-mode`.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  const updated = await setRampMonitoringMode(
    req.context,
    schedule,
    req.body.enabled ? "auto" : "manual",
  );
  return rampScheduleToApiInterface(updated);
});
