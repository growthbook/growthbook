import type { Response } from "express";
import { RampScheduleInterface } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  advanceStep,
  advanceUntilBlocked,
  approveAndPublishStep,
  completeRollout,
  computeNextStepAt,
  dispatchRampEvent,
  makeAttribution,
  rollbackToStep,
} from "back-end/src/services/rampSchedule";

type StartTrigger =
  | { type: "immediately" }
  | { type: "manual" }
  | { type: "scheduled"; at: Date | string };

type EndSchedule = {
  trigger: { type: "scheduled"; at: Date | string };
  actions: RampScheduleInterface["steps"][number]["actions"];
};

type CreateBody = Pick<
  RampScheduleInterface,
  "name" | "entityType" | "entityId" | "targets" | "steps"
> & {
  autoRollback?: RampScheduleInterface["autoRollback"];
  startTrigger?: StartTrigger;
  startActions?: RampScheduleInterface["startActions"];
  disableOutsideSchedule?: boolean;
  endSchedule?: EndSchedule;
};

type UpdateBody = Partial<Pick<RampScheduleInterface, "name" | "steps">> & {
  autoRollback?: RampScheduleInterface["autoRollback"];
  startTrigger?: StartTrigger | null;
  startActions?: RampScheduleInterface["startActions"] | null;
  disableOutsideSchedule?: boolean | null;
  endSchedule?: EndSchedule | null;
};

type ActionBody = {
  reason?: string;
  source?: string;
  targetStepIndex?: number;
};

function withElapsedMs(schedule: RampScheduleInterface): RampScheduleInterface {
  if (!schedule.startedAt) return schedule;
  return { ...schedule, elapsedMs: Date.now() - schedule.startedAt.getTime() };
}

// GET /ramp-schedule
export const getRampSchedules = async (
  req: AuthRequest<null, null, { featureId?: string; status?: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const { featureId } = req.query;

  const schedules = featureId
    ? await context.models.rampSchedules.getAllByFeatureId(featureId)
    : await context.models.rampSchedules.getAll();

  res
    .status(200)
    .json({ status: 200, rampSchedules: schedules.map(withElapsedMs) });
};

// GET /ramp-schedule/:id
export const getRampSchedule = async (
  req: AuthRequest<null, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const schedule = await context.models.rampSchedules.getById(req.params.id);
  if (!schedule) {
    return res
      .status(404)
      .json({ status: 404, message: "Ramp schedule not found" });
  }
  res.status(200).json({ status: 200, rampSchedule: withElapsedMs(schedule) });
};

// POST /ramp-schedule
export const postRampSchedule = async (
  req: AuthRequest<CreateBody>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const body = req.body;

  const disable = !!body.disableOutsideSchedule;
  // Mirror the disableOutsideSchedule injection done in the atomic features controller:
  // auto-prepend enabled:true to startActions and auto-append enabled:false to endSchedule.
  const firstTarget = body.targets[0];
  const enabledPatch = firstTarget
    ? { ruleId: firstTarget.ruleId ?? "", enabled: true }
    : undefined;
  const disabledPatch = firstTarget
    ? { ruleId: firstTarget.ruleId ?? "", enabled: false }
    : undefined;

  const baseStartActions = body.startActions ?? [];
  const startActions =
    disable && enabledPatch
      ? [
          { targetId: firstTarget!.id, patch: enabledPatch },
          ...baseStartActions,
        ]
      : baseStartActions.length
        ? baseStartActions
        : undefined;

  const baseEndActions = body.endSchedule?.actions ?? [];
  const endActions =
    disable && disabledPatch
      ? [...baseEndActions, { targetId: firstTarget!.id, patch: disabledPatch }]
      : baseEndActions;

  const schedule = await context.models.rampSchedules.create({
    name: body.name,
    entityType: body.entityType,
    entityId: body.entityId,
    targets: body.targets,
    steps: body.steps,
    autoRollback: body.autoRollback,
    startTrigger: body.startTrigger
      ? body.startTrigger.type === "scheduled"
        ? { type: "scheduled", at: new Date(body.startTrigger.at) }
        : body.startTrigger
      : { type: "immediately" },
    startActions: startActions?.length ? startActions : undefined,
    disableOutsideSchedule: disable || undefined,
    endSchedule: body.endSchedule
      ? {
          trigger: {
            type: "scheduled",
            at: new Date(body.endSchedule.trigger.at),
          },
          actions: endActions,
        }
      : undefined,
    // Standalone ramps have no activating revision — they're immediately eligible to start.
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    stepHistory: [],
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  await dispatchRampEvent(context, schedule, "created", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: context.org.id,
      entityType: schedule.entityType,
      entityId: schedule.entityId,
      userId: context.userId || undefined,
    },
  });

  res.status(200).json({ status: 200, rampSchedule: schedule });
};

// PUT /ramp-schedule/:id
export const putRampSchedule = async (
  req: AuthRequest<UpdateBody, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const schedule = await context.models.rampSchedules.getById(req.params.id);
  if (!schedule) {
    return res
      .status(404)
      .json({ status: 404, message: "Ramp schedule not found" });
  }
  if (!["pending", "ready", "paused"].includes(schedule.status)) {
    return res.status(400).json({
      status: 400,
      message: `Cannot update ramp schedule in status "${schedule.status}".`,
    });
  }

  const body = req.body;
  const updates: Record<string, unknown> = {};
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

  const updated = await context.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );
  res.status(200).json({ status: 200, rampSchedule: updated });
};

// DELETE /ramp-schedule/:id
export const deleteRampSchedule = async (
  req: AuthRequest<null, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const schedule = await context.models.rampSchedules.getById(req.params.id);
  if (!schedule) {
    return res
      .status(404)
      .json({ status: 404, message: "Ramp schedule not found" });
  }
  if (["running", "pending-approval"].includes(schedule.status)) {
    return res.status(400).json({
      status: 400,
      message: `Cannot delete a ramp schedule in status "${schedule.status}". Pause or complete it first.`,
    });
  }
  await context.models.rampSchedules.deleteById(schedule.id);

  await dispatchRampEvent(context, schedule, "deleted", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: context.org.id,
      userId: context.userId || undefined,
    },
  });

  res.status(200).json({ status: 200, deletedId: schedule.id });
};

// POST /ramp-schedule/:id/actions/:action
export const postRampScheduleAction = async (
  req: AuthRequest<ActionBody, { id: string; action: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const schedule = await context.models.rampSchedules.getById(req.params.id);
  if (!schedule) {
    return res
      .status(404)
      .json({ status: 404, message: "Ramp schedule not found" });
  }

  const attribution = makeAttribution(
    context.userId || undefined,
    req.body.reason,
    req.body.source,
  );

  const now = new Date();
  let updated: RampScheduleInterface;

  switch (req.params.action) {
    case "start":
      if (schedule.status !== "ready") {
        return res.status(400).json({
          status: 400,
          message: `Cannot start a schedule in status "${schedule.status}" — must be "ready"`,
        });
      }
      updated = await context.models.rampSchedules.updateById(schedule.id, {
        status: "running",
        startedAt: now,
        phaseStartedAt: now,
      });
      // Advance step 0 immediately (and any subsequent overdue steps) inline.
      await advanceUntilBlocked(context, updated, now, attribution);
      updated =
        (await context.models.rampSchedules.getById(schedule.id)) ?? updated;
      await dispatchRampEvent(context, updated, "started", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId ?? undefined,
          reason: attribution.reason ?? undefined,
          source: attribution.source ?? undefined,
        },
      });
      break;

    case "pause":
      if (!["running", "pending-approval"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot pause a schedule in status "${schedule.status}"`,
        });
      }
      updated = await context.models.rampSchedules.updateById(schedule.id, {
        status: "paused",
        pausedAt: now,
      });
      await dispatchRampEvent(context, updated, "paused", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId ?? undefined,
          reason: attribution.reason ?? undefined,
          source: attribution.source ?? undefined,
        },
      });
      break;

    case "resume": {
      if (schedule.status !== "paused") {
        return res.status(400).json({
          status: 400,
          message: `Cannot resume a schedule in status "${schedule.status}"`,
        });
      }
      // Shift phaseStartedAt and nextStepAt forward by the duration of the pause
      // so interval steps continue from exactly where they left off.
      // When resuming after a terminal restart startedAt/phaseStartedAt will be
      // null (cleared by the reset), so we anchor them to now as a fresh start.
      const pauseDurationMs = schedule.pausedAt
        ? now.getTime() - schedule.pausedAt.getTime()
        : 0;

      const newStartedAt = schedule.startedAt ? schedule.startedAt : now;

      const newPhaseStartedAt = schedule.phaseStartedAt
        ? new Date(
            schedule.phaseStartedAt.getTime() +
              (pauseDurationMs > 0 ? pauseDurationMs : 0),
          )
        : now;

      const resumeUpdates: Record<string, unknown> = {
        status: "running",
        pausedAt: null,
        startedAt: newStartedAt,
        phaseStartedAt: newPhaseStartedAt,
      };

      if (schedule.nextStepAt) {
        // Shift the existing deadline forward by the pause duration.
        resumeUpdates.nextStepAt = new Date(
          schedule.nextStepAt.getTime() + pauseDurationMs,
        );
      } else {
        // nextStepAt was null (after a reset/rollback). Recompute from the
        // now-anchored phaseStartedAt so the agenda job picks this ramp up.
        const nextStepIndex = schedule.currentStepIndex + 1;
        if (nextStepIndex < schedule.steps.length) {
          const tempSchedule = {
            ...schedule,
            startedAt: newStartedAt,
            phaseStartedAt: newPhaseStartedAt,
          };
          resumeUpdates.nextStepAt = computeNextStepAt(
            tempSchedule,
            nextStepIndex,
            now,
          );
        }
      }

      // Clear stale pending revision tracking from before the pause
      // (e.g., a rollback revision that was already auto-published).
      // Preserve them only when pendingApprovalRevisionId is set — that
      // means an approval gate is still open and we must not discard it.
      if (!schedule.pendingApprovalRevisionId) {
        resumeUpdates.pendingRevisionIds = [];
      }
      updated = await context.models.rampSchedules.updateById(
        schedule.id,
        resumeUpdates,
      );
      // Advance immediately if step 0 is pending (fresh/restarted ramp) or
      // if any steps became overdue during a long pause.
      await advanceUntilBlocked(context, updated, now, attribution);
      updated =
        (await context.models.rampSchedules.getById(schedule.id)) ?? updated;
      await dispatchRampEvent(context, updated, "resumed", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId ?? undefined,
          reason: attribution.reason ?? undefined,
          source: attribution.source ?? undefined,
        },
      });
      break;
    }

    case "advance":
      if (!["running", "paused"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot advance a schedule in status "${schedule.status}"`,
        });
      }
      updated = await advanceStep(context, schedule, attribution);
      break;

    case "rollback": {
      const targetStepIndex = req.body.targetStepIndex ?? -1;
      updated = await rollbackToStep(
        context,
        schedule,
        targetStepIndex,
        attribution,
      );
      break;
    }

    case "complete":
      if (["completed", "expired", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Schedule is already in terminal status "${schedule.status}"`,
        });
      }
      updated = await completeRollout(context, schedule, attribution);
      break;

    case "reset": {
      const isTerminal = ["completed", "expired", "rolled-back"].includes(
        schedule.status,
      );
      // Revert all applied steps to the initial state.
      // For terminal states (restart): clear timing fields and set to "ready"
      // so the user starts the ramp fresh with an explicit Start action.
      // For active states: stay paused so the user can resume from the beginning.
      const resetRolled =
        schedule.currentStepIndex >= 0
          ? await rollbackToStep(context, schedule, -1, attribution)
          : schedule;
      // Both terminal and non-terminal restarts land in "paused" so the user
      // must explicitly resume to kick off the ramp again. For terminal cases
      // we also clear the timing anchors so resume starts fresh from now.
      updated = await context.models.rampSchedules.updateById(resetRolled.id, {
        status: "paused",
        pausedAt: now,
        pendingRevisionIds: [],
        pendingApprovalRevisionId: null,
        ...(isTerminal && {
          startedAt: null,
          phaseStartedAt: null,
        }),
      });
      await dispatchRampEvent(context, updated, "reset", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId ?? undefined,
          reason: attribution.reason ?? undefined,
          source: attribution.source ?? undefined,
        },
      });
      break;
    }

    case "jump": {
      if (["completed", "expired", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot jump a schedule in terminal status "${schedule.status}"`,
        });
      }
      const jumpTarget: number =
        typeof req.body.targetStepIndex === "number"
          ? req.body.targetStepIndex
          : -1;
      if (jumpTarget < -1 || jumpTarget >= schedule.steps.length) {
        return res.status(400).json({
          status: 400,
          message: `Invalid targetStepIndex ${jumpTarget}`,
        });
      }

      // After any jump, reset phaseStartedAt so the target step's interval
      // runs fresh from resume time rather than being stale from the original start.
      // phaseStartedAt = now - sum(intervals of steps 0..target-1)
      // This ensures nextStepAt = phaseStartedAt + sum(0..target) = now + steps[target].seconds
      const freshPhaseStartedAt = (() => {
        if (jumpTarget <= 0) return now;
        let elapsed = 0;
        for (let i = 0; i < jumpTarget; i++) {
          const t = schedule.steps[i]?.trigger;
          if (t?.type === "interval") elapsed += t.seconds;
        }
        return new Date(now.getTime() - elapsed * 1000);
      })();

      if (jumpTarget < schedule.currentStepIndex) {
        // Backward: rollback then override to paused, clearing any pending approval state
        const j = await rollbackToStep(
          context,
          schedule,
          jumpTarget,
          attribution,
        );
        updated = await context.models.rampSchedules.updateById(j.id, {
          status: "paused",
          pausedAt: now,
          phaseStartedAt: freshPhaseStartedAt,
          nextStepAt: null,
          pendingRevisionIds: [],
          pendingApprovalRevisionId: null,
        });
      } else if (jumpTarget > schedule.currentStepIndex) {
        // Forward: advance step-by-step up to target, then pause
        let current = schedule;
        while (current.currentStepIndex < jumpTarget) {
          current = await advanceStep(context, current, attribution);
        }
        updated = await context.models.rampSchedules.updateById(current.id, {
          status: "paused",
          pausedAt: now,
          phaseStartedAt: freshPhaseStartedAt,
          nextStepAt: null,
        });
      } else {
        // Same position: just pause
        updated = await context.models.rampSchedules.updateById(schedule.id, {
          status: "paused",
          pausedAt: now,
          phaseStartedAt: freshPhaseStartedAt,
          nextStepAt: null,
        });
      }
      await dispatchRampEvent(context, updated, "jumped", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          targetStepIndex: jumpTarget,
          userId: attribution.userId ?? undefined,
          reason: attribution.reason ?? undefined,
          source: attribution.source ?? undefined,
        },
      });
      break;
    }

    case "approve-step": {
      if (schedule.status !== "pending-approval") {
        return res.status(400).json({
          status: 400,
          message: `Cannot approve step: schedule is not in "pending-approval" status (currently "${schedule.status}")`,
        });
      }
      const approveErr = await approveAndPublishStep(context, schedule);
      if (approveErr) {
        const httpStatus =
          approveErr.code === "permission_denied"
            ? 403
            : approveErr.code === "merge_conflict"
              ? 409
              : approveErr.code === "no_pending_approval" ||
                  approveErr.code === "revision_not_found"
                ? 404
                : 400;
        return res.status(httpStatus).json({
          status: httpStatus,
          code: approveErr.code,
          message:
            approveErr.code === "merge_conflict"
              ? `Merge conflict on: ${approveErr.detail}. Open the draft to resolve conflicts before continuing.`
              : approveErr.code === "permission_denied"
                ? `Permission denied: ${approveErr.detail}`
                : approveErr.code === "no_pending_approval"
                  ? "No pending approval revision found for this ramp step"
                  : approveErr.code === "revision_not_found"
                    ? "Pending approval revision no longer exists"
                    : `Error: ${"detail" in approveErr ? approveErr.detail : approveErr.code}`,
        });
      }
      // onRevisionPublished hook advances the ramp — re-fetch for fresh state
      const afterApprove = await context.models.rampSchedules.getById(
        schedule.id,
      );
      if (!afterApprove) {
        return res.status(404).json({
          status: 404,
          message: "Ramp schedule not found after approve",
        });
      }
      updated = afterApprove;
      break;
    }

    default:
      return res.status(400).json({
        status: 400,
        message: `Unknown action "${req.params.action}"`,
      });
  }

  res.status(200).json({ status: 200, rampSchedule: updated });
};
