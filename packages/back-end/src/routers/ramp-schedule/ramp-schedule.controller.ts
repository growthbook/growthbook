import type { Response } from "express";
import { RampScheduleInterface } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  advanceStep,
  advanceUntilBlocked,
  applyStartConditionActions,
  approveAndPublishStep,
  completeRollout,
  computeNextProcessAt,
  computeNextStepAt,
  dispatchRampEvent,
  jumpAheadToStep,
  rollbackToStep,
} from "back-end/src/services/rampSchedule";

type StartTrigger =
  | { type: "immediately" }
  | { type: "manual" }
  | { type: "scheduled"; at: Date | string };

type EndTrigger = { type: "scheduled"; at: Date | string };

type StartCondition = {
  trigger: StartTrigger;
  actions?: RampScheduleInterface["steps"][number]["actions"];
};

type EndCondition = {
  trigger?: EndTrigger;
  actions?: RampScheduleInterface["steps"][number]["actions"];
};

type CreateBody = Pick<
  RampScheduleInterface,
  "name" | "entityType" | "entityId" | "targets" | "steps"
> & {
  startCondition?: StartCondition;
  disableRuleBefore?: boolean;
  disableRuleAfter?: boolean;
  endEarlyWhenStepsComplete?: boolean;
  endCondition?: EndCondition;
};

type UpdateBody = Partial<Pick<RampScheduleInterface, "name" | "steps">> & {
  controlledFields?: string[];
  startCondition?: StartCondition | null;
  disableRuleBefore?: boolean;
  disableRuleAfter?: boolean;
  endEarlyWhenStepsComplete?: boolean;
  endCondition?: EndCondition | null;
};

type ActionBody = {
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

  const disableBefore = !!body.disableRuleBefore;
  const disableAfter = !!body.disableRuleAfter;
  const firstTarget = body.targets[0];
  const enabledPatch = firstTarget
    ? { ruleId: firstTarget.ruleId ?? "", enabled: true }
    : undefined;
  const disabledPatch = firstTarget
    ? { ruleId: firstTarget.ruleId ?? "", enabled: false }
    : undefined;

  const rawStartTrigger = body.startCondition?.trigger;
  const resolvedStartTrigger: RampScheduleInterface["startCondition"]["trigger"] =
    rawStartTrigger
      ? rawStartTrigger.type === "scheduled"
        ? { type: "scheduled", at: new Date(rawStartTrigger.at) }
        : rawStartTrigger
      : { type: "immediately" };

  const baseStartActions = body.startCondition?.actions ?? [];
  const startConditionActions =
    disableBefore && enabledPatch
      ? [
          {
            targetType: "feature-rule" as const,
            targetId: firstTarget!.id,
            patch: enabledPatch,
          },
          ...baseStartActions,
        ]
      : baseStartActions;

  const baseEndActions = body.endCondition?.actions ?? [];
  const endConditionActions =
    disableAfter && disabledPatch
      ? [
          ...baseEndActions,
          {
            targetType: "feature-rule" as const,
            targetId: firstTarget!.id,
            patch: disabledPatch,
          },
        ]
      : baseEndActions;

  const rawEndTrigger = body.endCondition?.trigger;
  const resolvedEndTrigger = rawEndTrigger
    ? { type: "scheduled" as const, at: new Date(rawEndTrigger.at) }
    : undefined;

  const endCondition =
    resolvedEndTrigger || endConditionActions.length
      ? { trigger: resolvedEndTrigger, actions: endConditionActions }
      : undefined;

  const schedule = await context.models.rampSchedules.create({
    name: body.name,
    entityType: body.entityType,
    entityId: body.entityId,
    targets: body.targets,
    steps: body.steps,
    startCondition: {
      trigger: resolvedStartTrigger,
      actions: startConditionActions.length ? startConditionActions : undefined,
    },
    disableRuleBefore: disableBefore || undefined,
    disableRuleAfter: disableAfter || undefined,
    endEarlyWhenStepsComplete: body.endEarlyWhenStepsComplete,
    endCondition,
    // Standalone ramps have no activating revision — they're immediately eligible to start.
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt:
      resolvedStartTrigger.type === "scheduled"
        ? resolvedStartTrigger.at
        : null,
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
  if (body.controlledFields !== undefined) {
    updates.targets = schedule.targets.map((t) => ({
      ...t,
      controlledFields: body.controlledFields,
    }));
  }
  if (body.startCondition !== undefined) {
    const sc = body.startCondition;
    if (!sc) {
      updates.startCondition = { trigger: { type: "immediately" } };
    } else {
      const rawTrigger = sc.trigger;
      const trigger =
        rawTrigger?.type === "scheduled"
          ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
          : (rawTrigger ?? { type: "immediately" as const });
      updates.startCondition = {
        trigger,
        actions: sc.actions ?? undefined,
      };
    }
  }
  if (body.endCondition !== undefined) {
    const ec = body.endCondition;
    if (!ec) {
      updates.endCondition = undefined;
    } else {
      const rawTrigger = ec.trigger;
      const trigger = rawTrigger
        ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
        : undefined;
      updates.endCondition = {
        trigger,
        actions: ec.actions ?? undefined,
      };
    }
  }
  if (body.disableRuleBefore !== undefined) {
    updates.disableRuleBefore = body.disableRuleBefore;
  }
  if (body.disableRuleAfter !== undefined) {
    updates.disableRuleAfter = body.disableRuleAfter;
  }

  // Recompute injected enabled patches when disableRuleBefore/After flags change.
  const effectiveDisableBefore =
    body.disableRuleBefore !== undefined
      ? body.disableRuleBefore
      : (schedule.disableRuleBefore ?? false);
  const effectiveDisableAfter =
    body.disableRuleAfter !== undefined
      ? body.disableRuleAfter
      : (schedule.disableRuleAfter ?? false);

  if (
    body.disableRuleBefore !== undefined ||
    body.disableRuleAfter !== undefined ||
    body.startCondition !== undefined ||
    body.endCondition !== undefined
  ) {
    const primaryTarget = schedule.targets.find(
      (t) => t.entityType === "feature" && t.entityId === schedule.entityId,
    );
    if (primaryTarget) {
      const enabledPatch = {
        ruleId: primaryTarget.ruleId,
        enabled: true as const,
      };
      const disabledPatch = {
        ruleId: primaryTarget.ruleId,
        enabled: false as const,
      };

      const currentSc =
        (updates.startCondition as typeof schedule.startCondition) ??
        schedule.startCondition;
      if (currentSc) {
        const baseStartActions = (currentSc.actions ?? []).filter(
          (a) => !("enabled" in a.patch),
        );
        updates.startCondition = {
          ...currentSc,
          actions: effectiveDisableBefore
            ? [
                {
                  targetType: "feature-rule" as const,
                  targetId: primaryTarget.id,
                  patch: enabledPatch,
                },
                ...baseStartActions,
              ]
            : baseStartActions.length
              ? baseStartActions
              : undefined,
        };
      }

      const currentEc = (
        "endCondition" in updates ? updates.endCondition : schedule.endCondition
      ) as typeof schedule.endCondition;
      if (currentEc || effectiveDisableAfter) {
        const baseEndActions = (currentEc?.actions ?? []).filter(
          (a) => !("enabled" in a.patch),
        );
        updates.endCondition = currentEc
          ? {
              ...currentEc,
              actions: effectiveDisableAfter
                ? [
                    ...baseEndActions,
                    {
                      targetType: "feature-rule" as const,
                      targetId: primaryTarget.id,
                      patch: disabledPatch,
                    },
                  ]
                : baseEndActions.length
                  ? baseEndActions
                  : undefined,
            }
          : effectiveDisableAfter
            ? {
                actions: [{ targetId: primaryTarget.id, patch: disabledPatch }],
              }
            : undefined;
      }
    }
  }
  if (body.endEarlyWhenStepsComplete !== undefined) {
    updates.endEarlyWhenStepsComplete = body.endEarlyWhenStepsComplete;
  }

  updates.nextProcessAt = computeNextProcessAt({
    status: schedule.status,
    nextStepAt: schedule.nextStepAt,
    endCondition: ("endCondition" in updates
      ? updates.endCondition
      : schedule.endCondition) as RampScheduleInterface["endCondition"],
    startCondition: ("startCondition" in updates
      ? updates.startCondition
      : schedule.startCondition) as RampScheduleInterface["startCondition"],
  });

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

  await dispatchRampEvent(context, schedule, "rampSchedule.deleted", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: context.org.id,
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

  const now = new Date();
  let updated: RampScheduleInterface;

  switch (req.params.action) {
    case "start": {
      if (schedule.status !== "ready") {
        return res.status(400).json({
          status: 400,
          message: `Cannot start a schedule in status "${schedule.status}" — must be "ready"`,
        });
      }
      const initialNextStepAt = schedule.steps.length > 0 ? now : null;
      updated = await context.models.rampSchedules.updateById(schedule.id, {
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
      await applyStartConditionActions(context, updated);
      await advanceUntilBlocked(context, updated, now);
      updated =
        (await context.models.rampSchedules.getById(schedule.id)) ?? updated;
      await dispatchRampEvent(
        context,
        updated,
        "rampSchedule.actions.started",
        {
          object: {
            rampScheduleId: updated.id,
            rampName: updated.name,
            orgId: context.org.id,
            currentStepIndex: updated.currentStepIndex,
            status: updated.status,
          },
        },
      );
      break;
    }

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
        nextProcessAt: null,
      });
      break;

    case "resume": {
      if (schedule.status !== "paused") {
        return res.status(400).json({
          status: 400,
          message: `Cannot resume a schedule in status "${schedule.status}"`,
        });
      }
      // Shift timing anchors forward by the pause duration so interval steps continue
      // exactly where they left off. Null anchors (post-reset) anchor to now.
      const pauseDurationMs = schedule.pausedAt
        ? now.getTime() - schedule.pausedAt.getTime()
        : 0;

      const newStartedAt = schedule.startedAt ? schedule.startedAt : now;
      const newPhaseStartedAt = schedule.phaseStartedAt
        ? new Date(
            schedule.phaseStartedAt.getTime() + Math.max(0, pauseDurationMs),
          )
        : now;

      // Resuming at an approval gate returns to "pending-approval" — not "running".
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
          // nextStepAt is null (after a reset/rollback).
          // At start: fire step 0 immediately. Mid-schedule: restart current step's hold timer.
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
        status: resumeUpdates.status as RampScheduleInterface["status"],
        nextStepAt: resumeUpdates.nextStepAt as Date | null | undefined,
        endCondition: schedule.endCondition,
        startCondition: schedule.startCondition,
      });

      updated = await context.models.rampSchedules.updateById(
        schedule.id,
        resumeUpdates,
      );
      if (!pausedAtApproval) {
        await advanceUntilBlocked(context, updated, now);
      }
      updated =
        (await context.models.rampSchedules.getById(schedule.id)) ?? updated;
      break;
    }

    case "advance":
      if (!["running", "paused"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Cannot advance a schedule in status "${schedule.status}"`,
        });
      }
      updated = await advanceStep(context, schedule);
      break;

    case "rollback":
      updated = await rollbackToStep(context, schedule, -1);
      break;

    case "complete":
      if (["completed", "rolled-back"].includes(schedule.status)) {
        return res.status(400).json({
          status: 400,
          message: `Schedule is already in terminal status "${schedule.status}"`,
        });
      }
      updated = await completeRollout(context, schedule);
      break;

    case "reset": {
      const isTerminal = ["completed", "rolled-back"].includes(schedule.status);
      // Roll back to start (-1), then land in "paused" so the user must explicitly resume.
      // Terminal restarts also clear timing anchors so resume starts fresh.
      const resetRolled =
        schedule.currentStepIndex >= 0
          ? await rollbackToStep(context, schedule, -1)
          : schedule;
      updated = await context.models.rampSchedules.updateById(resetRolled.id, {
        status: "paused",
        pausedAt: now,
        nextProcessAt: null,
        ...(isTerminal && {
          startedAt: null,
          phaseStartedAt: null,
        }),
      });
      await dispatchRampEvent(
        context,
        updated,
        "rampSchedule.actions.rolledBack",
        {
          object: {
            rampScheduleId: updated.id,
            rampName: updated.name,
            orgId: context.org.id,
            currentStepIndex: updated.currentStepIndex,
            status: updated.status,
            targetStepIndex: -1,
          },
        },
      );
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

      // Reset phaseStartedAt so the target step's hold timer runs from now.
      // phaseStartedAt = now - sum(intervals[0..target-1]) ensures nextStepAt = now + steps[target].seconds
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
        const j = await rollbackToStep(context, schedule, jumpTarget);
        updated = await context.models.rampSchedules.updateById(j.id, {
          status: "paused",
          pausedAt: now,
          phaseStartedAt: freshPhaseStartedAt,
          nextStepAt: null,
          nextProcessAt: null,
        });
      } else if (jumpTarget > schedule.currentStepIndex) {
        updated = await jumpAheadToStep(context, schedule, jumpTarget);
      } else {
        updated = await context.models.rampSchedules.updateById(schedule.id, {
          status: "paused",
          pausedAt: now,
          phaseStartedAt: freshPhaseStartedAt,
          nextStepAt: null,
          nextProcessAt: null,
        });
      }
      await dispatchRampEvent(context, updated, "rampSchedule.actions.jumped", {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: context.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          targetStepIndex: jumpTarget,
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

    default:
      return res.status(400).json({
        status: 400,
        message: `Unknown action "${req.params.action}"`,
      });
  }

  res.status(200).json({ status: 200, rampSchedule: updated });
};
