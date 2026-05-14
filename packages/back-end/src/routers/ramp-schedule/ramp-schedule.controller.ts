import type { Response } from "express";
import { RampScheduleInterface } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  advanceScheduleManually,
  appendRampEvent,
  approveAndPublishStep,
  completeRollout,
  computeNextProcessAt,
  dispatchRampEvent,
  jumpSchedule,
  pauseSchedule,
  rollbackSchedule,
  restartSchedule,
  resumeSchedule,
  setRampMonitoringMode,
  startSchedule,
} from "back-end/src/services/rampSchedule";

type CreateBody = Pick<
  RampScheduleInterface,
  "name" | "entityType" | "entityId" | "targets" | "steps"
> & {
  startActions?: RampScheduleInterface["startActions"];
  endActions?: RampScheduleInterface["endActions"];
  startDate?: string | null;
  cutoffDate?: string | null;
  lockdownConfig?: RampScheduleInterface["lockdownConfig"];
  monitoringConfig?: RampScheduleInterface["monitoringConfig"];
  experimentHealthAction?: RampScheduleInterface["experimentHealthAction"];
};

type UpdateBody = Partial<Pick<RampScheduleInterface, "name" | "steps">> & {
  startActions?: RampScheduleInterface["startActions"];
  endActions?: RampScheduleInterface["endActions"];
  startDate?: string | null;
  cutoffDate?: string | null;
  lockdownConfig?: RampScheduleInterface["lockdownConfig"];
  monitoringConfig?: RampScheduleInterface["monitoringConfig"];
  experimentHealthAction?: RampScheduleInterface["experimentHealthAction"];
};

type ActionBody = {
  targetStepIndex?: number;
  reason?: string;
  enabled?: boolean;
  monitoringMode?: "auto" | "manual";
};

function normalizeMonitoringConfig(
  monitoringConfig: RampScheduleInterface["monitoringConfig"] | undefined,
) {
  if (!monitoringConfig) return monitoringConfig;
  if (!monitoringConfig.monitoringMode) return monitoringConfig;
  return {
    ...monitoringConfig,
    autoUpdate: monitoringConfig.monitoringMode === "auto",
  };
}

function withElapsedMs(schedule: RampScheduleInterface): RampScheduleInterface {
  if (!schedule.startedAt) return schedule;
  return { ...schedule, elapsedMs: Date.now() - schedule.startedAt.getTime() };
}

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

export const postRampSchedule = async (
  req: AuthRequest<CreateBody>,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("schedule-feature-flag")) {
    context.throwPlanDoesNotAllowError(
      "Ramp schedules require a Pro plan or above.",
    );
  }

  const body = req.body;

  const startDate = body.startDate ? new Date(body.startDate) : undefined;

  const schedule = await context.models.rampSchedules.create({
    name: body.name,
    entityType: body.entityType,
    entityId: body.entityId,
    targets: body.targets,
    startActions: body.startActions,
    steps: body.steps,
    endActions: body.endActions,
    startDate,
    cutoffDate: body.cutoffDate ? new Date(body.cutoffDate) : null,
    lockdownConfig: body.lockdownConfig,
    monitoringConfig: normalizeMonitoringConfig(body.monitoringConfig),
    experimentHealthAction: body.experimentHealthAction,
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: startDate ?? null,
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  await dispatchRampEvent(context, schedule, "rampSchedule.created", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: context.org.id,
      entityType: schedule.entityType,
      entityId: schedule.entityId,
    },
  });

  res.status(200).json({ status: 200, rampSchedule: schedule });
};

export const putRampSchedule = async (
  req: AuthRequest<UpdateBody, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("schedule-feature-flag")) {
    context.throwPlanDoesNotAllowError(
      "Ramp schedules require a Pro plan or above.",
    );
  }

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
  if (body.startActions !== undefined) updates.startActions = body.startActions;
  if (body.steps !== undefined) updates.steps = body.steps;
  if (body.endActions !== undefined) updates.endActions = body.endActions;
  if ("startDate" in body) {
    updates.startDate = body.startDate ? new Date(body.startDate) : null;
  }
  if ("cutoffDate" in body) {
    updates.cutoffDate = body.cutoffDate ? new Date(body.cutoffDate) : null;
  }
  if (body.lockdownConfig !== undefined) {
    updates.lockdownConfig = body.lockdownConfig;
  }
  if (body.monitoringConfig !== undefined) {
    updates.monitoringConfig = normalizeMonitoringConfig(body.monitoringConfig);
  }
  if (body.experimentHealthAction !== undefined) {
    updates.experimentHealthAction = body.experimentHealthAction;
  }
  updates.nextProcessAt = computeNextProcessAt({
    status: schedule.status,
    nextStepAt: schedule.nextStepAt,
    cutoffDate: ("cutoffDate" in updates
      ? updates.cutoffDate
      : schedule.cutoffDate) as RampScheduleInterface["cutoffDate"],
    startDate: ("startDate" in updates
      ? updates.startDate
      : schedule.startDate) as RampScheduleInterface["startDate"],
  });

  const editedFields = Object.keys(updates).filter(
    (k) => k !== "nextProcessAt" && k !== "eventHistory",
  );
  if (editedFields.length > 0) {
    updates.eventHistory = appendRampEvent(schedule, "config-edited", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason: `Edited: ${editedFields.join(", ")}`,
    });
  }

  const updated = await context.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );
  res.status(200).json({ status: 200, rampSchedule: updated });
};

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

  await dispatchRampEvent(context, schedule, "rampSchedule.deleted", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: context.org.id,
    },
  });

  res.status(200).json({ status: 200, deletedId: schedule.id });
};

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

  let updated: RampScheduleInterface;

  switch (req.params.action) {
    case "start": {
      if (schedule.status !== "ready") {
        return res.status(400).json({
          status: 400,
          message: `Cannot start a schedule in status "${schedule.status}" — must be "ready"`,
        });
      }
      updated = await startSchedule(context, schedule);
      break;
    }

    case "pause":
      if (!["running", "pending-approval"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot pause a schedule in status "${schedule.status}"`,
        });
      }
      updated = await pauseSchedule(context, schedule);
      break;

    case "resume": {
      if (schedule.status !== "paused") {
        return res.status(400).json({
          status: 400,
          message: `Cannot resume a schedule in status "${schedule.status}"`,
        });
      }
      updated = await resumeSchedule(context, schedule);
      break;
    }

    case "advance": {
      if (!["running", "paused"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot advance a schedule in status "${schedule.status}"`,
        });
      }
      updated = await advanceScheduleManually(context, schedule);
      break;
    }

    case "complete":
      if (["completed", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Schedule is already in terminal status "${schedule.status}"`,
        });
      }
      updated = await completeRollout(context, schedule);
      break;

    case "rollback": {
      if (["completed", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Schedule is already in terminal status "${schedule.status}"`,
        });
      }
      const cause = req.body?.reason?.trim();
      const reason = cause ? `Manual: ${cause}` : "Manual";
      updated = await rollbackSchedule(context, schedule, reason);
      break;
    }

    case "restart": {
      if (!["rolled-back", "completed"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot restart a schedule in status "${schedule.status}". Only terminal (rolled-back / completed) schedules can be restarted.`,
        });
      }
      updated = await restartSchedule(context, schedule);
      break;
    }

    case "jump": {
      if (["completed", "rolled-back"].includes(schedule.status)) {
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

      updated = await jumpSchedule(context, schedule, jumpTarget);
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
        const httpStatus = approveErr.code === "permission_denied" ? 403 : 400;
        return res.status(httpStatus).json({
          status: httpStatus,
          code: approveErr.code,
          message:
            approveErr.code === "permission_denied"
              ? `Permission denied: ${approveErr.detail}`
              : `Error: ${"detail" in approveErr ? approveErr.detail : approveErr.code}`,
        });
      }
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

    case "set-monitoring-mode":
    case "set-auto-update": {
      if (!schedule.monitoringConfig) {
        return res.status(400).json({
          status: 400,
          message:
            "Cannot change monitoring mode on a schedule without monitoring configuration",
        });
      }
      const requestedMode =
        req.params.action === "set-auto-update"
          ? req.body.enabled === false
            ? "manual"
            : "auto"
          : req.body.monitoringMode;
      if (requestedMode !== "auto" && requestedMode !== "manual") {
        return res.status(400).json({
          status: 400,
          message: 'monitoringMode must be "auto" or "manual"',
        });
      }
      updated = await setRampMonitoringMode(context, schedule, requestedMode);
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
