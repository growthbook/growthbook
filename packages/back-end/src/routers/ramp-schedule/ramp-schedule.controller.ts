import type { Response } from "express";
import { RampScheduleInterface } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  advanceStep,
  completeRollout,
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
    // Standalone ramps have no founding revision — they're immediately eligible to start.
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
      updated = await advanceStep(context, updated, attribution);
      await dispatchRampEvent(context, updated, "started", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId,
          reason: attribution.reason,
          source: attribution.source,
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
          userId: attribution.userId,
          reason: attribution.reason,
          source: attribution.source,
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
      updated = await context.models.rampSchedules.updateById(
        schedule.id,
        resumeUpdates,
      );
      await dispatchRampEvent(context, updated, "resumed", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId,
          reason: attribution.reason,
          source: attribution.source,
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
      if (["completed", "expired", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot reset a schedule in terminal status "${schedule.status}"`,
        });
      }
      // Revert all applied steps to the initial state, but stay paused (not rolled-back)
      // so the user can resume from the beginning.
      const resetRolled = await rollbackToStep(
        context,
        schedule,
        -1,
        attribution,
      );
      updated = await context.models.rampSchedules.updateById(resetRolled.id, {
        status: "paused",
        pausedAt: now,
      });
      await dispatchRampEvent(context, updated, "reset", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          userId: attribution.userId,
          reason: attribution.reason,
          source: attribution.source,
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
      if (jumpTarget < schedule.currentStepIndex) {
        // Backward: rollback then override to paused
        const j = await rollbackToStep(
          context,
          schedule,
          jumpTarget,
          attribution,
        );
        updated = await context.models.rampSchedules.updateById(j.id, {
          status: "paused",
          pausedAt: now,
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
          nextStepAt: null,
        });
      } else {
        // Same position: just pause
        updated = await context.models.rampSchedules.updateById(schedule.id, {
          status: "paused",
          pausedAt: now,
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
          userId: attribution.userId,
          reason: attribution.reason,
          source: attribution.source,
        },
      });
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
