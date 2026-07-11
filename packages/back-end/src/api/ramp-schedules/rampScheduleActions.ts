import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { PermissionError } from "shared/util";
import {
  apiRampScheduleInterface,
  DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS,
  rampMonitoringConfig,
  lockdownConfigSchema,
  stepHoldConditions,
} from "shared/validators";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { getHealthSettings } from "shared/enterprise";
import { expandMetricGroups } from "shared/experiments";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import {
  advanceScheduleManually,
  approveAndPublishStep,
  completeRampKeepCutoff,
  completeRollout,
  ensureSafeRolloutForMonitoredRamp,
  getEffectiveRampAutoUpdateState,
  getRampMonitoringMode,
  jumpSchedule,
  pauseSchedule,
  rollbackSchedule,
  restartSchedule,
  resumeSchedule,
  runLockedRampScheduleAction,
  setRampMonitoringMode,
  startSchedule,
  syncLinkedSafeRolloutForRampState,
  updateRampLockdownConfig,
  updateRampMonitoringConfig,
  updateRampSteps,
} from "back-end/src/services/rampSchedule";
import { evaluateCurrentStep } from "back-end/src/services/rampScheduleEvaluator";
import { getFeature } from "back-end/src/models/FeatureModel";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";
import { getMetricsByIds } from "back-end/src/models/MetricModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ConflictError } from "back-end/src/util/errors";
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
    "Transitions the schedule from `ready` to `running`. The schedule must have\nat least one target rule attached — a schedule created without targets starts\nin `pending` and moves to `ready` automatically when the first target is\nattached via `/actions/add-target`.\n\nThe first step is processed immediately: interval-free steps advance right\naway; interval-based steps arm a timer. Once started, use `/actions/pause`\nto halt, `/actions/advance` to skip steps, or `/actions/rollback` to revert.\n",
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

  const current = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh, heartbeat) => {
      if (fresh.status !== "ready") {
        throw new ConflictError(
          `Cannot start: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return startSchedule(req.context, fresh, heartbeat);
    },
  );
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
    "Pauses a `running` schedule. Traffic percentages are frozen at their current\nvalues; no step advancement happens while paused. Records `pausedAt` so that\ninterval timing can be correctly offset when the schedule resumes.\n\nUse `/actions/resume` to continue from the same step, or `/actions/rollback`\nto revert all rule effects entirely.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  if (schedule.status !== "running") {
    throw new Error(
      `Cannot pause a ramp schedule in status "${schedule.status}"`,
    );
  }

  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      if (fresh.status !== "running") {
        throw new ConflictError(
          `Cannot pause: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return pauseSchedule(req.context, fresh);
    },
  );

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
    "Resumes a `paused` schedule without moving the current step. Timing anchors\n(`phaseStartedAt`, `startedAt`) are shifted forward by the pause duration so\nthat interval-based steps continue from where they left off rather than\nrestarting their clock.\n\nDoes **not** advance to the next step — use `/actions/advance` if you also\nwant to skip the remainder of the current step.\n",
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

  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh, heartbeat) => {
      if (fresh.status !== "paused") {
        throw new ConflictError(
          `Cannot resume: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return resumeSchedule(req.context, fresh, heartbeat);
    },
  );

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
    "Teleports the schedule to `targetStepIndex` (forward or backward) and leaves\nit `paused`. Resets timing anchors so the destination step's interval starts\nfresh when the schedule is next resumed or started.\n\nPass `-1` to return to the pre-start position without applying rollback rule\npatches — useful for resetting a non-started schedule. For a full traffic\nrevert, use `/actions/rollback` instead.\n\nAccepts any non-terminal schedule status.\n",
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

  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      if (["completed", "rolled-back"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot jump: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return jumpSchedule(req.context, fresh, targetStepIndex);
    },
  );

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

export const completeRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({ disableRule: z.boolean().optional() }).optional(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/complete",
  operationId: "completeRampSchedule",
  summary: "Complete a ramp schedule immediately",
  description:
    "Immediately applies the schedule's end-state rule patches (the equivalent\nof what would happen after the last step advances normally) and marks the\nschedule as `completed`, skipping any remaining steps.\n\nPass `disableRule: true` to also disable the linked rule (equivalent to\nthe cutoff-date-driven completion).\n",
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

  const completed = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      if (["completed", "rolled-back"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot complete: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      const isSimple = fresh.steps.length === 0 && !!fresh.cutoffDate;
      const disableNow = req.body?.disableRule === true || isSimple;
      const hasFutureCutoff = fresh.cutoffDate && fresh.cutoffDate > new Date();

      if (!disableNow && hasFutureCutoff) {
        return completeRampKeepCutoff(req.context, fresh);
      }
      return completeRollout(req.context, fresh, {
        disableActiveTargets: disableNow,
      });
    },
  );

  return { rampSchedule: rampScheduleToApiInterface(completed) };
});

export const approveStepRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/approve-step",
  operationId: "approveStepRampSchedule",
  summary: "Approve the current step",
  description:
    "Satisfies the `holdConditions.requiresApproval` gate on the current step of\na `running` schedule.\n\nApproval is the **final** gate: it can only be granted once every other hold\non the step has already cleared. This endpoint rejects the request (`400`) if\nthe step is not yet ready for approval — for example while the interval timer\nis still counting down, or (for monitored steps) before fresh analysis\ncovering the step is available or while a guardrail/health signal is failing.\nPoll the `/status` endpoint and only call this once it reports the step is\nawaiting approval.\n\n**Non-monitored steps**: once the interval has elapsed, approving clears the\nlast hold and the schedule advances immediately, chaining through any\nsubsequent instant steps in the same request.\n\n**Monitored steps**: once the interval has elapsed and fresh, healthy analysis\nis available, approving clears the last hold and the agenda advances the step\non its next tick (re-checking the latest analysis once more first).\n\nDifferent from `/actions/advance`: `approve-step` works within the normal\nevaluation flow and refuses to skip ahead of the interval or any other\nunmet gate. Use `/actions/advance` only if you want to bypass all remaining\nholds entirely (including the interval timer).\n\nRequires feature review permissions for the associated feature.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const currentStep = schedule.steps[schedule.currentStepIndex];
  const awaitingApproval =
    schedule.status === "running" &&
    currentStep?.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex;

  if (!awaitingApproval) {
    throw new Error(
      `Cannot approve step: schedule is not awaiting approval (currently "${schedule.status}")`,
    );
  }

  const err = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      // Pin to the step the reviewer saw — a queued approval must not land
      // on a step that was never reviewed.
      if (fresh.currentStepIndex !== schedule.currentStepIndex) {
        throw new ConflictError(
          "Cannot approve step: the schedule advanced while the request was in flight",
        );
      }
      // Idempotency and awaiting-approval validation live in
      // approveAndPublishStep, AFTER its permission checks — duplicating them
      // here would return success to callers that were never permission-checked.
      return approveAndPublishStep(req.context, fresh, "api");
    },
  );
  if (err) {
    const detail = "detail" in err ? err.detail : undefined;
    if (err.code === "permission_denied") {
      throw new PermissionError(`Permission denied: ${detail ?? err.code}`);
    }
    if (err.code === "not_ready") {
      // Approval is the final gate — the interval (and, for monitored steps,
      // fresh analysis) has not cleared yet. Reject rather than record it.
      throw new Error(`Cannot approve step yet: ${detail ?? "not ready"}`);
    }
    throw new Error(detail ?? err.code);
  }

  const updated =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? schedule;

  await req.audit({
    event: "rampSchedule.step-approved",
    entity: { object: "rampSchedule", id: schedule.id },
    details: JSON.stringify({
      stepIndex: updated.currentStepIndex,
      stepApproval: updated.stepApproval,
    }),
  });

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
    'Rewinds all ramp effects (rule coverage, targeting, etc.) to the starting\nposition and lands in terminal `rolled-back` status. The reason is persisted\nas `lastRollbackReason` (prefixed with `Manual: `) and surfaced in the UI.\n\nThis is also the correct response to a monitoring alert — when the\n`/status` endpoint returns `decision: "rollback"` or signals include\n`guardrail-failing`, call this endpoint with a descriptive `reason`.\n\nFrom this terminal state the schedule can be brought back to `ready` via\n`/actions/restart`, after which `/actions/start` will run it again.\n',
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
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      if (["completed", "rolled-back"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot rollback: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return rollbackSchedule(req.context, fresh, reason);
    },
  );

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

  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh, heartbeat) => {
      if (!["rolled-back", "completed"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot restart: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      return restartSchedule(req.context, fresh, heartbeat);
    },
  );
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

  // Locked: concurrent add/eject calls would drop a target, and a stale
  // pending→ready flip could rewind a scheduler-activated schedule.
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    async (fresh) => {
      // Re-check exclusivity in-lock: a racing add could otherwise put the
      // rule under two schedules whose advances publish competing coverage.
      const freshConflicts =
        await req.context.models.rampSchedules.findByTargetRule(
          ruleId,
          environment ?? undefined,
        );
      if (freshConflicts.some((c) => c.id !== fresh.id)) {
        throw new ConflictError(
          `Another schedule attached rule '${ruleId}'${envSuffix} while the request was in flight.`,
        );
      }
      if (
        fresh.targets.some((t) =>
          rampTargetsEquivalent(t, {
            ruleId,
            environment: environment ?? null,
          }),
        )
      ) {
        throw new ConflictError(
          `Rule '${ruleId}'${envSuffix} is already a target of this schedule.`,
        );
      }
      const isFirstTarget = fresh.targets.length === 0;
      const entityUpdate = fresh.entityId === "" ? { entityId: featureId } : {};
      const statusUpdate =
        isFirstTarget && fresh.status === "pending"
          ? { status: "ready" as const }
          : {};

      return req.context.models.rampSchedules.updateById(fresh.id, {
        targets: [...fresh.targets, newTarget],
        ...entityUpdate,
        ...statusUpdate,
      });
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

  // Locked: the targets filter is a read-modify-write, and the last-target
  // deleteById must not remove the doc out from under an in-flight advance.
  return runLockedRampScheduleAction(
    req.context,
    schedule.id,
    async (fresh) => {
      const remaining = fresh.targets.filter((t) => {
        if (targetId) return t.id !== targetId;
        return !rampTargetsEquivalent(t, {
          ruleId,
          environment: environment ?? null,
        });
      });

      if (remaining.length === fresh.targets.length) {
        throw new Error("No matching target found on this schedule");
      }

      if (remaining.length === 0) {
        // No rollback is applied when the last target is ejected. This is intentional:
        // "eject" means "remove the schedule and leave the rule as-is right now" — the
        // feature rule stays at whatever coverage/state it is currently at, under the
        // user's full manual control from this point. If the intent were to revert the
        // rule to its pre-ramp state, the caller should execute a rollback action first
        // (which applies startActions) and then eject, or use the delete-schedule flow
        // that already pauses/rolls back before removing.
        //
        // Stop the linked SafeRollout before deleting so agenda ticks don't keep
        // firing against a now-deleted parent schedule.
        if (fresh.safeRolloutId) {
          await syncLinkedSafeRolloutForRampState(
            req.context,
            { ...fresh, status: "rolled-back" },
            "stopped",
          );
        }
        await req.context.models.rampSchedules.deleteById(fresh.id);
        return { deleted: true, rampScheduleId: fresh.id };
      }

      const updated = await req.context.models.rampSchedules.updateById(
        fresh.id,
        { targets: remaining },
      );

      return { rampSchedule: rampScheduleToApiInterface(updated) };
    },
  );
});

export const apiAdvanceRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z
    .object({
      reason: z.string().optional().describe("Reason for advancing"),
      force: z
        .boolean()
        .optional()
        .describe(
          "Bypass a pending approval gate on the current step. Requires admin-level (`canBypassApprovalChecks`) permission. When omitted or `false`, a 409 is returned if the step has an unsatisfied `holdConditions.requiresApproval` gate.",
        ),
    })
    .optional(),
  responseSchema: rampScheduleResponse,
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/advance",
  operationId: "apiAdvanceRampSchedule",
  summary: "Advance to the next step, overriding any holds",
  description:
    'Moves the schedule to the next step, bypassing **all** hold conditions —\ninterval, min sample size, and monitoring signal holds. Accepts `running`\nor `paused` status; if paused, the schedule is implicitly resumed (timing\nanchors recalculated) before the step moves.\n\n**Approval gate**: if the current step has an unsatisfied\n`holdConditions.requiresApproval` gate, this endpoint returns **409** by\ndefault. Either call `/actions/approve-step` first (recommended), or pass\n`force: true` to override the approval gate. `force: true` requires\n`canBypassApprovalChecks` permission and is logged in the audit trail.\n\n**Two common uses:**\n- **Post-interval monitoring hold** (`decision: "hold"`, interval elapsed): the\n  step timer has completed but a signal or guardrail is flagging concern. Use\n  this after reviewing the `/status` health summary and deciding to accept the\n  risk and proceed.\n- **Hard override**: skip a step regardless of where it is in its interval or\n  hold conditions (CI gate, external deployment pipeline).\n\nWhen to use other actions instead:\n- **`/actions/resume`** — restores a paused schedule without moving the step.\n- **`/actions/approve-step`** — clears only the approval gate; other conditions\n  still resolve naturally.\n- **`/actions/rollback`** — preferred response when `decision: "rollback"` or\n  signals include `guardrail-failing`.\n',
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  if (!["running", "paused"].includes(schedule.status)) {
    throw new Error(`Cannot advance a schedule in status "${schedule.status}"`);
  }

  const force = req.body?.force ?? false;
  const currentStep = schedule.steps[schedule.currentStepIndex];
  const approvalPending =
    currentStep?.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex;

  if (approvalPending && !force) {
    throw new ConflictError(
      "This step requires approval before advancing. Call `/actions/approve-step` first, or pass `force: true` to bypass (requires canBypassApprovalChecks permission).",
    );
  }
  if (approvalPending && force) {
    const feature = await getFeature(req.context, schedule.entityId);
    if (!feature || !req.context.permissions.canBypassApprovalChecks(feature)) {
      throw new PermissionError(
        "force: true requires canBypassApprovalChecks permission on the linked feature",
      );
    }
  }

  let bypassedApproval = false;
  let current = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    async (fresh) => {
      if (!["running", "paused"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot advance: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      // Pin the playhead: a concurrent advance would make this skip an
      // extra (unscreened) step.
      if (fresh.currentStepIndex !== schedule.currentStepIndex) {
        throw new ConflictError(
          "Cannot advance: the schedule advanced while the request was in flight",
        );
      }
      // Re-derive the approval gate — holdConditions can change in place
      // (steps editors allow it on the current step) while we waited.
      const freshStep = fresh.steps[fresh.currentStepIndex];
      const freshApprovalPending =
        freshStep?.holdConditions?.requiresApproval &&
        fresh.stepApproval?.stepIndex !== fresh.currentStepIndex;
      if (freshApprovalPending && !force) {
        throw new ConflictError(
          "This step requires approval before advancing. Call `/actions/approve-step` first, or pass `force: true` to bypass (requires canBypassApprovalChecks permission).",
        );
      }
      if (freshApprovalPending && force) {
        const linkedFeature = await getFeature(req.context, fresh.entityId);
        if (
          !linkedFeature ||
          !req.context.permissions.canBypassApprovalChecks(linkedFeature)
        ) {
          throw new PermissionError(
            "force: true requires canBypassApprovalChecks permission on the linked feature",
          );
        }
        bypassedApproval = true;
      }
      return advanceScheduleManually(req.context, fresh);
    },
  );
  // Audit after the advance succeeds so the trail never records a bypass that
  // was rejected by the in-lock validation.
  if (bypassedApproval) {
    await req.audit({
      event: "rampSchedule.approval-bypassed",
      entity: { object: "rampSchedule", id: schedule.id },
      details: JSON.stringify({
        stepIndex: schedule.currentStepIndex,
        reason: req.body?.reason,
      }),
    });
  }
  current =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? current;

  return { rampSchedule: rampScheduleToApiInterface(current) };
});

const healthSummaryMetricSchema = z.object({
  id: z.string().describe("Metric ID."),
  name: z
    .string()
    .optional()
    .describe(
      "Human-readable metric name. Absent if the metric definition has been deleted.",
    ),
  status: z
    .enum(["failing", "within-bounds", "not-enough-data"])
    .describe(
      "`failing` = statistically significant regression; `within-bounds` = no significant harm detected; `not-enough-data` = insufficient data to evaluate.",
    ),
  role: z
    .enum(["guardrail", "signal"])
    .describe(
      "Whether this metric is a guardrail (triggers rollback on loss) or a signal (triggers hold on loss).",
    ),
  relativeLift: z
    .number()
    .optional()
    .describe(
      "Expected relative lift of the treatment arm vs the baseline arm (e.g. 0.05 = +5%). See `traffic.variationUnits` for what each arm represents.",
    ),
  absoluteLift: z
    .number()
    .optional()
    .describe(
      "Absolute difference in conversion rate between the treatment and baseline arms.",
    ),
  ciHarmBound: z
    .number()
    .optional()
    .describe(
      "One-tailed CI bound in the direction of potential harm. For normal metrics (higher is better) this is the lower CI bound; for inverse metrics (lower is better, e.g. errors, latency) this is the upper CI bound. Values further from zero in the harmful direction indicate greater potential regression.",
    ),
  pValue: z
    .number()
    .optional()
    .describe(
      "Two-sided p-value for the metric effect. Only present when the stats engine produces a frequentist result.",
    ),
});

const healthSummarySchema = z.object({
  safeToAdvance: z
    .boolean()
    .describe(
      "True only when every hold condition is cleared: the step interval has elapsed, any required approval has been granted, min sample size is met, and all monitored metrics are within bounds. Equivalent to `decision === 'advance'`.",
    ),
  decision: z
    .enum(["advance", "hold", "rollback", "pause"])
    .describe(
      "Current evaluator decision for the active step. Incorporates all hold conditions (timing, approval, min sample, metric health). When monitoring data is not yet available, the evaluator returns `hold` with a descriptive `decisionReason`.",
    ),
  decisionReason: z
    .string()
    .optional()
    .describe("Human-readable reason for a hold, rollback, or pause decision."),
  signals: z
    .array(
      z.enum([
        "guardrail-failing",
        "signal-regression",
        "srm",
        "multiple-exposures",
        "no-traffic",
        "below-min-sample",
        "healthy",
        "awaiting-data",
      ]),
    )
    .describe(
      "All active health signals, not just the top-priority one. Useful for surfacing multiple concurrent issues (e.g. SRM + guardrail failing simultaneously). `healthy` is the sole entry when no issues are detected.",
    ),
  snapshotAt: z
    .string()
    .optional()
    .describe("ISO timestamp of the most recent successful analysis snapshot."),
  traffic: z
    .object({
      totalUsers: z
        .number()
        .describe("Total unique users across all variations."),
      variationUnits: z
        .array(z.number())
        .describe(
          "Per-variation user counts. Index 0 = baseline arm (users continuing to see the existing behavior — either the configured control value on a v1 safe rollout, or users passed through to subsequent rules / feature default on a v2 monitored ramp). Index 1 = treatment arm (users exposed to the new rollout value).",
        ),
      srm: z
        .object({
          pValue: z.number().describe("SRM p-value from the traffic query."),
          status: z
            .enum(["ok", "failing"])
            .describe(
              "`failing` when p-value is below the org SRM threshold, indicating a traffic imbalance.",
            ),
        })
        .optional(),
      multipleExposures: z
        .object({
          count: z
            .number()
            .describe("Number of users exposed to both variations."),
          percent: z
            .number()
            .describe("Fraction of total users with multiple exposures (0–1)."),
          status: z.enum(["ok", "warning"]),
        })
        .optional(),
    })
    .optional()
    .describe(
      "Traffic health from the latest snapshot. Absent when no snapshot has been taken yet.",
    ),
  metrics: z
    .record(z.string(), healthSummaryMetricSchema)
    .describe(
      "Per-metric health keyed by metric ID. Only includes metrics configured as guardrails or signals on this schedule.",
    ),
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
        safeRolloutId: z
          .string()
          .nullable()
          .optional()
          .describe("Internal ID of the linked monitoring experiment."),
      })
      .optional(),
    healthSummary: healthSummarySchema
      .optional()
      .describe(
        "Populated when monitoring is enabled and analysis data is available. Contains the current evaluator decision, aggregate traffic health, and per-metric status with effect sizes.",
      ),
  }),
  method: "get" as const,
  path: "/ramp-schedules/:id/status",
  operationId: "getRampScheduleStatus",
  summary: "Get ramp schedule status summary",
  description:
    "Returns a real-time status summary for a ramp schedule: current step, overall health decision, traffic quality, and per-metric effect sizes. Designed for CI pipeline integrations and monitoring dashboards that need a single call to determine whether it is safe to advance.",
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

  let healthSummary: z.infer<typeof healthSummarySchema> | undefined;

  if (schedule.safeRolloutId && schedule.monitoringConfig) {
    const safeRollout = await req.context.models.safeRollout.getById(
      schedule.safeRolloutId,
    );

    if (!safeRollout?.analysisSummary) {
      const decision = await evaluateCurrentStep(
        req.context,
        schedule,
        new Date(),
      );
      healthSummary = {
        safeToAdvance: decision.action === "advance",
        decision: decision.action,
        decisionReason: "reason" in decision ? decision.reason : undefined,
        signals: ["awaiting-data"],
        metrics: {},
      };
    } else {
      const summary = safeRollout.analysisSummary;

      const snapshot = summary.snapshotId
        ? await req.context.models.safeRolloutSnapshots.getById(
            summary.snapshotId,
          )
        : null;

      // Index per-metric deviation data from the first successful analysis,
      // "All" dimension (results[0]), treatment variation (index 1).
      const snapshotAnalysis = snapshot?.analyses?.find(
        (a) => a.status === "success",
      );
      const allDimResult = snapshotAnalysis?.results?.[0];
      const controlMetrics = allDimResult?.variations?.[0]?.metrics ?? {};
      const treatmentMetrics = allDimResult?.variations?.[1]?.metrics ?? {};

      // --- Traffic health ---
      const trafficOverall = snapshot?.health?.traffic?.overall;
      const variationUnits = trafficOverall?.variationUnits ?? [];
      const totalUsers = variationUnits.reduce((a, b) => a + b, 0);

      const healthSettings = getHealthSettings(req.context.org.settings);
      const srmPValue = trafficOverall?.srm;

      let trafficBlock:
        | z.infer<typeof healthSummarySchema>["traffic"]
        | undefined;
      if (snapshot) {
        const srmHealthStatus =
          srmPValue !== undefined && totalUsers > 0
            ? getSRMHealthData({
                srm: srmPValue,
                srmThreshold: healthSettings.srmThreshold,
                numOfVariations: 2,
                totalUsersCount: totalUsers,
                minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
              })
            : null;

        const meCount = snapshot.multipleExposures ?? 0;
        const meHealth =
          totalUsers > 0
            ? getMultipleExposureHealthData({
                multipleExposuresCount: meCount,
                totalUsersCount: totalUsers,
                minCountThreshold:
                  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
                minPercentThreshold: healthSettings.multipleExposureMinPercent,
              })
            : null;

        trafficBlock = {
          totalUsers,
          variationUnits,
          srm:
            srmPValue !== undefined
              ? {
                  pValue: srmPValue,
                  status: srmHealthStatus === "unhealthy" ? "failing" : "ok",
                }
              : undefined,
          multipleExposures: meHealth
            ? {
                count: meCount,
                percent: totalUsers > 0 ? meCount / totalUsers : 0,
                status: meHealth.status === "unhealthy" ? "warning" : "ok",
              }
            : undefined,
        };
      }

      // --- Expand metric groups into individual metric IDs ---
      const metricGroups = await req.context.models.metricGroups.getAll();
      const expandedGuardrailIds = expandMetricGroups(
        schedule.monitoringConfig.guardrailMetricIds ?? [],
        metricGroups,
      );
      const expandedSignalIds = expandMetricGroups(
        schedule.monitoringConfig.signalMetricIds ?? [],
        metricGroups,
      );
      const guardrailIds = new Set(expandedGuardrailIds);
      const signalIds = new Set(expandedSignalIds);

      // --- Metric inverse map (load only the expanded IDs) ---
      const allMetricIds = [
        ...new Set([...expandedGuardrailIds, ...expandedSignalIds]),
      ];
      const legacyMetrics = await getMetricsByIds(req.context, allMetricIds);
      const inverseMap = new Map<string, boolean>();
      const nameMap = new Map<string, string>();
      for (const m of legacyMetrics) {
        inverseMap.set(m.id, !!m.inverse);
        nameMap.set(m.id, m.name);
      }
      const missingIds = allMetricIds.filter((id) => !inverseMap.has(id));
      await Promise.all(
        missingIds.map(async (id) => {
          const fm = await req.context.models.factMetrics.getById(id);
          if (fm) {
            inverseMap.set(id, !!fm.inverse);
            nameMap.set(id, fm.name);
          }
        }),
      );

      // --- Per-metric health ---
      const metrics: z.infer<typeof healthSummarySchema>["metrics"] = {};
      const variations = summary.resultsStatus?.variations ?? [];
      const treatmentVar = variations[1] ?? variations[0];

      for (const [metricId, gm] of Object.entries(
        treatmentVar?.guardrailMetrics ?? {},
      )) {
        const tm = treatmentMetrics[metricId];
        const cm = controlMetrics[metricId];
        const isInverse = inverseMap.get(metricId) ?? false;
        metrics[metricId] = {
          id: metricId,
          name: nameMap.get(metricId),
          status:
            gm.status === "lost"
              ? "failing"
              : gm.status === "safe"
                ? "within-bounds"
                : "not-enough-data",
          role: guardrailIds.has(metricId) ? "guardrail" : "signal",
          relativeLift: tm?.expected,
          absoluteLift:
            tm?.cr !== undefined && cm?.cr !== undefined
              ? tm.cr - cm.cr
              : undefined,
          ciHarmBound:
            tm?.ci !== undefined
              ? isInverse
                ? tm.ci[1]
                : tm.ci[0]
              : undefined,
          pValue: tm?.pValue,
        };
      }

      // --- Signals (mirrors frontend computeSignals, all issues at once) ---
      const signals: z.infer<typeof healthSummarySchema>["signals"] = [];

      if (!snapshot) {
        signals.push("awaiting-data");
      } else if (totalUsers === 0) {
        const monitoringStart =
          schedule.monitoringStartDate ??
          schedule.currentStepEnteredAt ??
          schedule.startedAt;
        const inGrace =
          !!monitoringStart &&
          Date.now() - new Date(monitoringStart).getTime() <
            (schedule.monitoringConfig?.noTrafficGracePeriodHours ??
              DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS) *
              60 *
              60 *
              1000;
        signals.push(inGrace ? "awaiting-data" : "no-traffic");
      } else {
        if (trafficBlock?.srm?.status === "failing") signals.push("srm");

        if (trafficBlock?.multipleExposures?.status === "warning")
          signals.push("multiple-exposures");

        const currentStep = schedule.steps[schedule.currentStepIndex];
        const minSample = currentStep?.holdConditions?.minSampleSize;
        if (minSample && totalUsers < minSample)
          signals.push("below-min-sample");

        let hasGuardrailFailing = false;
        let hasSignalRegression = false;
        for (const [metricId, entry] of Object.entries(metrics)) {
          if (entry.status !== "failing") continue;
          if (guardrailIds.has(metricId)) hasGuardrailFailing = true;
          else if (signalIds.has(metricId)) hasSignalRegression = true;
        }
        if (hasGuardrailFailing) signals.push("guardrail-failing");
        if (hasSignalRegression) signals.push("signal-regression");

        if (signals.length === 0) signals.push("healthy");
      }

      // --- Evaluator decision (incorporates ALL hold conditions) ---
      const decision = await evaluateCurrentStep(
        req.context,
        schedule,
        new Date(),
      );

      healthSummary = {
        safeToAdvance: decision.action === "advance",
        decision: decision.action,
        decisionReason: "reason" in decision ? decision.reason : undefined,
        signals,
        snapshotAt: snapshot?.dateCreated?.toISOString(),
        traffic: trafficBlock,
        metrics,
      };
    }
  }

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
    healthSummary,
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
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) =>
      setRampMonitoringMode(req.context, fresh, req.body.monitoringMode),
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
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) =>
      setRampMonitoringMode(
        req.context,
        fresh,
        req.body.enabled ? "auto" : "manual",
      ),
  );
  return rampScheduleToApiInterface(updated);
});

export const updateMonitoringConfigRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: rampMonitoringConfig.describe(
    "Full replacement of the monitoring configuration. `datasourceId` and `exposureQueryId` cannot be changed while a monitoring experiment is active — stop the schedule first.",
  ),
  responseSchema: apiRampScheduleInterface,
  method: "put" as const,
  path: "/ramp-schedules/:id/monitoring",
  operationId: "updateRampScheduleMonitoring",
  summary: "Update ramp monitoring configuration",
  description:
    "Replaces the monitoring configuration. Metric IDs, snapshot cadence, and health-action thresholds (`srmAction`, `noTrafficAction`, etc.) can be updated at any time.\n\n`datasourceId` and `exposureQueryId` are locked once monitoring starts — stop and recreate the schedule to change the data source.\n\nChanges to guardrail or signal metric IDs take effect on the next analysis run.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => updateRampMonitoringConfig(req.context, fresh, req.body),
  );
  return rampScheduleToApiInterface(updated);
});

export const updateLockdownConfigRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: lockdownConfigSchema,
  responseSchema: apiRampScheduleInterface,
  method: "put" as const,
  path: "/ramp-schedules/:id/lockdown",
  operationId: "updateRampScheduleLockdown",
  summary: "Update ramp lockdown configuration",
  description:
    "Sets the lockdown mode. `locked` prevents other users from publishing unrelated changes to the parent feature while the ramp is running — useful when you want to ensure no external edits interfere with a live rollout. It does **not** affect the ramp's own auto-advancement or monitoring behavior; use `actions/pause` to halt the ramp itself. `none` removes the publishing restriction.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");
  const updated = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => updateRampLockdownConfig(req.context, fresh, req.body),
  );
  return rampScheduleToApiInterface(updated);
});

const putStepSchema = z.object({
  interval: z
    .number()
    .positive()
    .nullable()
    .describe(
      "Hold duration in seconds before this step's gates are evaluated. `null` means no time gate.",
    ),
  monitored: z
    .boolean()
    .optional()
    .describe(
      "When true, this step runs A/B traffic analysis while active. Applies only to future steps — cannot be changed on the currently executing step.",
    ),
  holdConditions: stepHoldConditions
    .optional()
    .describe(
      "Additional gates that must clear before the step advances: `minSampleSize` and/or `requiresApproval`.",
    ),
  approvalNotes: z
    .string()
    .nullish()
    .describe(
      "Optional notes shown to approvers when the step is awaiting approval.",
    ),
});

export const updateStepsRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.object({
    steps: z
      .array(putStepSchema)
      .describe(
        "Full replacement of the steps array. Step-level coverage patches (`actions`) are intentionally excluded — those require a revision publish because they change the SDK payload. Use the revision flow to modify coverage/targeting; use this endpoint to update monitoring flags and hold conditions.",
      ),
  }),
  responseSchema: z.object({
    rampSchedule: apiRampScheduleInterface,
  }),
  method: "put" as const,
  path: "/ramp-schedules/:id/steps",
  operationId: "updateRampScheduleSteps",
  summary: "Update ramp schedule steps",
  description:
    "Fully replaces the steps array for a ramp schedule. Only allowed when the schedule is in a non-running, non-terminal state (`ready`, `pending`, or `paused`). Pause a running schedule first; restart a terminal schedule first.\n\n**Step actions** (coverage/targeting patches) are not accepted here — they change the SDK payload and must go through a feature revision draft. Existing step actions are preserved for each position. Use `PUT /v2/features/:id/revisions/:version/rules/:ruleId/ramp-schedule` to modify coverage/targeting.\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  const { schedule: updated } = await runLockedRampScheduleAction(
    req.context,
    schedule.id,
    (fresh) => {
      // The PUT body intentionally omits step actions (coverage patches) —
      // preserve them from the in-lock doc so a concurrent advance's state
      // isn't clobbered.
      const incomingSteps: (typeof fresh)["steps"] = req.body.steps.map(
        (s, idx) => ({
          interval: s.interval,
          monitored: s.monitored ?? false,
          holdConditions: s.holdConditions,
          approvalNotes: s.approvalNotes ?? undefined,
          actions: fresh.steps[idx]?.actions ?? [],
        }),
      );
      return updateRampSteps(req.context, fresh, incomingSteps);
    },
  );

  return { rampSchedule: rampScheduleToApiInterface(updated) };
});

export const refreshMonitoringRampSchedule = createApiRequestHandler({
  paramsSchema: actionParamsSchema,
  bodySchema: z.never(),
  responseSchema: z.object({
    rampSchedule: apiRampScheduleInterface,
  }),
  method: "post" as const,
  path: "/ramp-schedules/:id/actions/refresh-monitoring",
  operationId: "refreshMonitoringRampSchedule",
  summary: "Trigger a manual monitoring update",
  description:
    "Queues a new analysis snapshot for the schedule's monitoring experiment.\nThe snapshot runs asynchronously — poll `GET /ramp-schedules/:id/status`\nuntil `snapshotAt` advances to confirm results are ready.\n\nOnly available when the schedule is within its monitored step window:\n- Not in a terminal state (`completed` or `rolled-back`).\n- Has at least one step with `monitored: true`.\n- `currentStepIndex` is within `[firstMonitoredStepIndex, lastMonitoredStepIndex]`.\n\nViolating any condition returns **409 Conflict** with a descriptive message.\n\nRequires the `runQueries` permission on the configured datasource (enforced via `canRunExperimentQueries`).\n",
  tags: ["ramp-schedules"],
})(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) throw new Error("Ramp schedule not found");

  if (["completed", "rolled-back"].includes(schedule.status)) {
    throw new ConflictError(
      `Cannot refresh monitoring on a terminal schedule (status: "${schedule.status}").`,
    );
  }

  const firstMonitoredStepIndex = schedule.steps.findIndex((s) => s.monitored);
  if (firstMonitoredStepIndex === -1) {
    throw new ConflictError(
      "This schedule has no monitored steps. Add a step with `monitored: true` to enable monitoring.",
    );
  }

  const lastMonitoredStepIndex = schedule.steps.reduce(
    (last, s, i) => (s.monitored ? i : last),
    -1,
  );

  if (schedule.currentStepIndex < firstMonitoredStepIndex) {
    throw new ConflictError(
      `Monitoring has not started yet. The schedule reaches its first monitored step at index ${firstMonitoredStepIndex} (current: ${schedule.currentStepIndex}).`,
    );
  }

  if (schedule.currentStepIndex > lastMonitoredStepIndex) {
    throw new ConflictError(
      `The schedule has moved past all monitored steps (last monitored: index ${lastMonitoredStepIndex}, current: ${schedule.currentStepIndex}).`,
    );
  }

  // If the current step is monitored and no SafeRollout exists yet, create it
  // lazily (mirrors the agenda job's behavior).
  const currentStep = schedule.steps[schedule.currentStepIndex];
  let safeRollout = schedule.safeRolloutId
    ? await req.context.models.safeRollout.getById(schedule.safeRolloutId)
    : null;

  if (!safeRollout && currentStep?.monitored) {
    // Serialize against the tick, which runs the same ensure — otherwise both
    // create a SafeRollout and one becomes an orphan.
    const updated = await runLockedRampScheduleAction(
      req.context,
      schedule.id,
      (fresh) => ensureSafeRolloutForMonitoredRamp(req.context, fresh),
    );
    safeRollout = updated.safeRolloutId
      ? await req.context.models.safeRollout.getById(updated.safeRolloutId)
      : null;
  }

  if (!safeRollout) {
    throw new ConflictError(
      "No monitoring experiment is linked to this schedule. Wait for the schedule to reach a monitored step or configure monitoring via `PUT /ramp-schedules/:id/monitoring`.",
    );
  }

  const datasourceId =
    safeRollout.datasourceId ?? schedule.monitoringConfig?.datasourceId;
  if (!datasourceId) {
    throw new Error(
      "No datasource configured for this schedule's monitoring experiment.",
    );
  }
  const datasource = await getDataSourceById(req.context, datasourceId);
  if (!datasource) {
    throw new Error(`Datasource "${datasourceId}" not found.`);
  }
  if (!req.context.permissions.canCreateExperimentSnapshot(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  const feature = safeRollout.featureId
    ? await getFeature(req.context, safeRollout.featureId)
    : null;

  await createSafeRolloutSnapshot({
    context: req.context,
    safeRollout,
    customFields: feature?.customFields,
    useCache: false,
    triggeredBy: "manual",
  });

  const updated =
    (await req.context.models.rampSchedules.getById(schedule.id)) ?? schedule;
  return { rampSchedule: rampScheduleToApiInterface(updated) };
});
