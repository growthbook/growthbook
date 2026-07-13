import type { Response } from "express";
import { RampScheduleInterface } from "shared/validators";
import { PermissionError } from "shared/util";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  advanceScheduleManually,
  appendRampEvent,
  assertCanUpdateLinkedSafeRolloutMonitoringConfig,
  approveAndPublishStep,
  completeRampKeepCutoff,
  completeRollout,
  computeNextProcessAt,
  dispatchRampEvent,
  ensureSafeRolloutForMonitoredRamp,
  jumpSchedule,
  pauseSchedule,
  rollbackSchedule,
  restartSchedule,
  resumeSchedule,
  runLockedRampScheduleAction,
  setRampMonitoringMode,
  startSchedule,
} from "back-end/src/services/rampSchedule";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { ConflictError } from "back-end/src/util/errors";

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
  force?: boolean;
  disableRule?: boolean;
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
  const updated = await runLockedRampScheduleAction(
    context,
    schedule.id,
    async (fresh) => {
      if (!["pending", "ready", "paused"].includes(fresh.status)) {
        throw new ConflictError(
          `Cannot update: schedule changed to "${fresh.status}" while the request was in flight`,
        );
      }
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.startActions !== undefined)
        updates.startActions = body.startActions;
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
        const monitoringConfig = normalizeMonitoringConfig(
          body.monitoringConfig,
        );
        await assertCanUpdateLinkedSafeRolloutMonitoringConfig(
          context,
          fresh,
          monitoringConfig,
        );
        updates.monitoringConfig = monitoringConfig;
      }
      if (body.experimentHealthAction !== undefined) {
        updates.experimentHealthAction = body.experimentHealthAction;
      }
      updates.nextProcessAt = computeNextProcessAt({
        status: fresh.status,
        nextStepAt: fresh.nextStepAt,
        cutoffDate: ("cutoffDate" in updates
          ? updates.cutoffDate
          : fresh.cutoffDate) as RampScheduleInterface["cutoffDate"],
        startDate: ("startDate" in updates
          ? updates.startDate
          : fresh.startDate) as RampScheduleInterface["startDate"],
      });

      const editedFields = Object.keys(updates).filter(
        (k) => k !== "nextProcessAt" && k !== "eventHistory",
      );
      if (editedFields.length > 0) {
        updates.eventHistory = appendRampEvent(fresh, "config-edited", {
          stepIndex: fresh.currentStepIndex,
          status: fresh.status,
          reason: `Edited: ${editedFields.join(", ")}`,
        });
      }

      return context.models.rampSchedules.updateById(fresh.id, updates);
    },
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
  if (schedule.status === "running") {
    return res.status(400).json({
      status: 400,
      message: `Cannot delete a ramp schedule in status "${schedule.status}". Pause or complete it first.`,
    });
  }
  // The delete intentionally leaves feature rule patches in place. By the time
  // deletion is allowed (status is not "running"), the schedule is either:
  //   - completed/rolled-back: the terminal completeRollout/rollbackToStep call
  //     already applied the final rule state (endActions or startActions), so
  //     there is nothing to revert.
  //   - paused/ready: the rule is at the last successfully applied step patch,
  //     which the user has chosen to keep by not rolling back before deleting.
  // In all cases the caller is assumed to have made a deliberate choice about
  // the rule's state before removing the schedule record.
  //
  // Locked so the doc can't be deleted out from under an in-flight advance
  // (whose subsequent writes would fail mid-publish).
  await runLockedRampScheduleAction(context, schedule.id, async (fresh) => {
    if (fresh.status === "running") {
      throw new ConflictError(
        "Cannot delete: the schedule started running while the request was in flight",
      );
    }
    await context.models.rampSchedules.deleteById(fresh.id);
  });

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
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh, heartbeat) => {
          if (fresh.status !== "ready") {
            throw new ConflictError(
              `Cannot start: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return startSchedule(context, fresh, heartbeat);
        },
      );
      break;
    }

    case "pause":
      if (schedule.status !== "running") {
        return res.status(400).json({
          status: 400,
          message: `Cannot pause a schedule in status "${schedule.status}"`,
        });
      }
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => {
          if (fresh.status !== "running") {
            throw new ConflictError(
              `Cannot pause: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return pauseSchedule(context, fresh);
        },
      );
      break;

    case "resume": {
      if (schedule.status !== "paused") {
        return res.status(400).json({
          status: 400,
          message: `Cannot resume a schedule in status "${schedule.status}"`,
        });
      }
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh, heartbeat) => {
          if (fresh.status !== "paused") {
            throw new ConflictError(
              `Cannot resume: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return resumeSchedule(context, fresh, heartbeat);
        },
      );
      break;
    }

    case "advance": {
      if (!["running", "paused"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot advance a schedule in status "${schedule.status}"`,
        });
      }
      const forceAdvance = req.body?.force === true;
      const advanceStep = schedule.steps[schedule.currentStepIndex];
      const approvalPending =
        advanceStep?.holdConditions?.requiresApproval &&
        schedule.stepApproval?.stepIndex !== schedule.currentStepIndex;
      if (approvalPending && !forceAdvance) {
        return res.status(409).json({
          status: 409,
          message:
            "This step requires approval before advancing. Use approve-step first, or pass force: true to bypass (requires canBypassApprovalChecks).",
        });
      }
      if (approvalPending && forceAdvance) {
        const linkedFeature = await getFeature(context, schedule.entityId);
        if (
          !linkedFeature ||
          !context.permissions.canBypassApprovalChecks(linkedFeature)
        ) {
          return res.status(403).json({
            status: 403,
            message:
              "Permission denied: canBypassApprovalChecks required on the linked feature",
          });
        }
      }
      updated = await runLockedRampScheduleAction(
        context,
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
          if (freshApprovalPending && !forceAdvance) {
            throw new ConflictError(
              "This step requires approval before advancing. Use approve-step first, or pass force: true to bypass (requires canBypassApprovalChecks).",
            );
          }
          if (freshApprovalPending && forceAdvance) {
            const linkedFeature = await getFeature(context, fresh.entityId);
            if (
              !linkedFeature ||
              !context.permissions.canBypassApprovalChecks(linkedFeature)
            ) {
              throw new PermissionError(
                "Permission denied: canBypassApprovalChecks required on the linked feature",
              );
            }
          }
          return advanceScheduleManually(context, fresh);
        },
      );
      break;
    }

    case "complete":
      if (["completed", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Schedule is already in terminal status "${schedule.status}"`,
        });
      }
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => {
          if (["completed", "rolled-back"].includes(fresh.status)) {
            throw new ConflictError(
              `Cannot complete: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          const isSimple = fresh.steps.length === 0 && !!fresh.cutoffDate;
          const disableNow = req.body?.disableRule === true || isSimple;
          const hasFutureCutoff =
            fresh.cutoffDate && fresh.cutoffDate > new Date();

          if (!disableNow && hasFutureCutoff) {
            return completeRampKeepCutoff(context, fresh);
          }
          return completeRollout(context, fresh, {
            disableActiveTargets: disableNow,
          });
        },
      );
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
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => {
          if (["completed", "rolled-back"].includes(fresh.status)) {
            throw new ConflictError(
              `Cannot rollback: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return rollbackSchedule(context, fresh, reason);
        },
      );
      break;
    }

    case "restart": {
      if (!["rolled-back", "completed"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot restart a schedule in status "${schedule.status}". Only terminal (rolled-back / completed) schedules can be restarted.`,
        });
      }
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh, heartbeat) => {
          if (!["rolled-back", "completed"].includes(fresh.status)) {
            throw new ConflictError(
              `Cannot restart: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return restartSchedule(context, fresh, heartbeat);
        },
      );
      break;
    }

    case "jump": {
      // `jump` always pauses on landing — see jumpSchedule.
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

      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => {
          if (["completed", "rolled-back"].includes(fresh.status)) {
            throw new ConflictError(
              `Cannot jump: schedule changed to "${fresh.status}" while the request was in flight`,
            );
          }
          return jumpSchedule(context, fresh, jumpTarget);
        },
      );
      break;
    }

    case "approve-step": {
      const currentStep = schedule.steps[schedule.currentStepIndex];
      const awaitingApproval =
        schedule.status === "running" &&
        currentStep?.holdConditions?.requiresApproval &&
        schedule.stepApproval?.stepIndex !== schedule.currentStepIndex;

      if (!awaitingApproval) {
        return res.status(400).json({
          status: 400,
          message: `Cannot approve step: schedule is not awaiting approval (currently "${schedule.status}")`,
        });
      }
      const approveErr = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => {
          // Pin to the step the reviewer saw — a queued approval must not
          // land on a step that was never reviewed.
          if (fresh.currentStepIndex !== schedule.currentStepIndex) {
            throw new ConflictError(
              "Cannot approve step: the schedule advanced while the request was in flight",
            );
          }
          // Idempotency and awaiting-approval validation live in
          // approveAndPublishStep, AFTER its permission checks — duplicating
          // them here would return success to unchecked callers.
          return approveAndPublishStep(context, fresh, "ui");
        },
      );
      if (approveErr) {
        const httpStatus =
          approveErr.code === "permission_denied"
            ? 403
            : approveErr.code === "not_ready"
              ? 409
              : 400;
        const message =
          approveErr.code === "permission_denied"
            ? `Permission denied: ${approveErr.detail}`
            : approveErr.code === "not_ready"
              ? `Cannot approve step yet: ${approveErr.detail}`
              : `Error: ${"detail" in approveErr ? approveErr.detail : approveErr.code}`;
        return res.status(httpStatus).json({
          status: httpStatus,
          code: approveErr.code,
          message,
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
      updated = await runLockedRampScheduleAction(
        context,
        schedule.id,
        (fresh) => setRampMonitoringMode(context, fresh, requestedMode),
      );
      break;
    }

    case "refresh-monitoring": {
      const firstMonitoredIdx = schedule.steps.findIndex((s) => s.monitored);
      const lastMonitoredIdx = schedule.steps.reduce(
        (last, s, i) => (s.monitored ? i : last),
        -1,
      );

      if (["completed", "rolled-back"].includes(schedule.status)) {
        return res.status(409).json({
          status: 409,
          message: `Cannot refresh monitoring on a terminal schedule (status: "${schedule.status}").`,
        });
      }
      if (firstMonitoredIdx === -1) {
        return res.status(409).json({
          status: 409,
          message: "This schedule has no monitored steps.",
        });
      }
      if (schedule.currentStepIndex < firstMonitoredIdx) {
        return res.status(409).json({
          status: 409,
          message: `Monitoring has not started yet (first monitored step: ${firstMonitoredIdx}, current: ${schedule.currentStepIndex}).`,
        });
      }
      if (schedule.currentStepIndex > lastMonitoredIdx) {
        return res.status(409).json({
          status: 409,
          message: `The schedule has moved past all monitored steps (last monitored: ${lastMonitoredIdx}, current: ${schedule.currentStepIndex}).`,
        });
      }

      const currentStep = schedule.steps[schedule.currentStepIndex];
      let safeRollout = schedule.safeRolloutId
        ? await context.models.safeRollout.getById(schedule.safeRolloutId)
        : null;

      if (!safeRollout && currentStep?.monitored) {
        // Serialize against the tick, which runs the same ensure — otherwise
        // both create a SafeRollout and one becomes an orphan.
        const updatedSchedule = await runLockedRampScheduleAction(
          context,
          schedule.id,
          (fresh) => ensureSafeRolloutForMonitoredRamp(context, fresh),
        );
        safeRollout = updatedSchedule.safeRolloutId
          ? await context.models.safeRollout.getById(
              updatedSchedule.safeRolloutId,
            )
          : null;
      }

      if (!safeRollout) {
        return res.status(409).json({
          status: 409,
          message:
            "No monitoring experiment is linked to this schedule yet. Wait for the schedule to reach a monitored step.",
        });
      }

      const datasourceId =
        safeRollout.datasourceId ?? schedule.monitoringConfig?.datasourceId;
      if (!datasourceId) {
        return res.status(400).json({
          status: 400,
          message:
            "No datasource configured for this schedule's monitoring experiment.",
        });
      }
      const datasource = await getDataSourceById(context, datasourceId);
      if (!datasource) {
        return res.status(400).json({
          status: 400,
          message: `Datasource "${datasourceId}" not found.`,
        });
      }
      if (!context.permissions.canCreateExperimentSnapshot(datasource)) {
        return res
          .status(403)
          .json({ status: 403, message: "Permission denied" });
      }

      const feature = safeRollout.featureId
        ? await getFeature(context, safeRollout.featureId)
        : null;

      await createSafeRolloutSnapshot({
        context,
        safeRollout,
        customFields: feature?.customFields,
        useCache: false,
        triggeredBy: "manual",
      });

      return res.status(200).json({ status: 200 });
    }

    default:
      return res.status(400).json({
        status: 400,
        message: `Unknown action "${req.params.action}"`,
      });
  }

  res.status(200).json({ status: 200, rampSchedule: updated });
};
