import type { Response } from "express";
import { z } from "zod";
import {
  RampScheduleInterface,
  RampStepAction,
  rampStep,
  getEffectiveRampStatus,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  advanceStep,
  advanceUntilBlocked,
  approveAndPublishStep,
  pauseSchedule,
  remapTemplateExperimentEndActions,
  remapTemplateExperimentSteps,
  resumeSchedule,
  startSchedule,
} from "back-end/src/services/rampSchedule";
import {
  applyRampEvaluationDecision,
  evaluateCurrentStep,
} from "back-end/src/services/rampScheduleEvaluator";
import {
  applyExperimentRollback,
  buildExperimentStartActions,
} from "back-end/src/services/experimentRampSchedule";

// ---------------------------------------------------------------------------
// GET /experiments/:id/ramp-schedule
// ---------------------------------------------------------------------------

export async function getRampSchedule(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return res
      .status(404)
      .json({ status: 404, message: "Experiment not found" });
  }
  if (!experiment.rampScheduleId) {
    return res.status(200).json({ status: 200, rampSchedule: null });
  }

  const schedule = await context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  return res.status(200).json({ status: 200, rampSchedule: schedule ?? null });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule  (attach / create)
// ---------------------------------------------------------------------------

const attachRampBody = z
  .object({
    name: z.string().min(1),
    // Provide explicit steps, or a templateId to materialize them from an
    // experiment ramp template. At least one is required.
    steps: z.array(rampStep).optional(),
    templateId: z.string().optional(),
  })
  .refine((d) => (d.steps !== undefined) !== (d.templateId !== undefined), {
    message: "Provide exactly one of steps or templateId",
  });

export async function postRampSchedule(
  req: AuthRequest<z.infer<typeof attachRampBody>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("ramp-schedules")) {
    context.throwPlanDoesNotAllowError(
      "Ramp schedules require an Enterprise plan.",
    );
  }
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return res
      .status(404)
      .json({ status: 404, message: "Experiment not found" });
  }
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  // Block only when a real ramp schedule already exists. A truthy but dangling
  // rampScheduleId (pointing at a deleted/missing schedule — an orphaned ref
  // from a prior bug or partial failure) must NOT block re-attaching, or the
  // experiment would be permanently stuck. In that case we let the attach
  // proceed and overwrite the dangling reference below.
  if (experiment.rampScheduleId) {
    const existing = await context.models.rampSchedules.getById(
      experiment.rampScheduleId,
    );
    if (existing) {
      return res.status(409).json({
        status: 409,
        message:
          "This experiment already has a ramp schedule. Delete the existing one first.",
      });
    }
  }

  const body = attachRampBody.parse(req.body);

  // Resolve steps (and optional end actions) from an explicit body or a
  // template. Templates must be experiment templates; the experiment id is
  // injected as each action's target at materialization time.
  let steps: RampScheduleInterface["steps"] = body.steps ?? [];
  let endActions: RampStepAction[] | undefined;
  if (body.templateId) {
    const template = await context.models.rampScheduleTemplates.getById(
      body.templateId,
    );
    if (!template) {
      return res
        .status(404)
        .json({ status: 404, message: "Template not found" });
    }
    if (template.entityType !== "experiment") {
      return res.status(400).json({
        status: 400,
        message:
          "Template is not an experiment ramp template; cannot apply it to an experiment.",
      });
    }
    // Templates capture the ramp structure only; automation (rollback /
    // progression / shipping) stays on the experiment + org defaults.
    steps = remapTemplateExperimentSteps(template.steps, experiment.id);
    endActions = remapTemplateExperimentEndActions(
      template.endPatch,
      experiment.id,
    );
  }

  // Experiment ramps are driven entirely by their steps — there's no date-only
  // rollout. The ramp's start/end are the experiment's (statusUpdateSchedule),
  // so the schedule's own startDate/cutoffDate (feature concepts) stay unset.
  if (steps.length === 0) {
    return res.status(400).json({
      status: 400,
      message: "Ramp schedule has no steps. Provide steps or a template.",
    });
  }

  const startActions = buildExperimentStartActions(experiment);

  const schedule = await context.models.rampSchedules.create({
    name: body.name,
    entityType: "experiment" as const,
    entityId: experiment.id,
    targets: [
      {
        id: `tgt_${experiment.id}`,
        entityType: "experiment" as const,
        entityId: experiment.id,
        ruleId: null,
        environment: null,
        status: "active" as const,
        activatingRevisionVersion: null,
      },
    ],
    startActions,
    steps,
    ...(endActions ? { endActions } : {}),
    startDate: null,
    cutoffDate: null,
    status: "ready" as const,
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: null,
  });

  try {
    await updateExperiment({
      context,
      experiment,
      // Clear any staged scheduled-stop: ramp experiments ship at ramp
      // completion, so a stopAt-driven stop must not also fire.
      changes: { rampScheduleId: schedule.id, nextScheduledStatusUpdate: null },
    });
  } catch (e) {
    // Don't leave an orphaned schedule the experiment doesn't point at (and
    // which would let a retry create a second one).
    await context.models.rampSchedules.delete(schedule);
    throw e;
  }

  // Start immediately only when the experiment is already running. A ramp
  // attached to a draft experiment must NOT begin ramping before the experiment
  // is live — it stays "ready" and is started by executeExperimentStart when
  // the experiment starts. (Experiment ramps have no separate ramp start date;
  // the experiment's own start governs when ramping begins.)
  const finalSchedule =
    experiment.status === "running"
      ? await startSchedule(context, schedule)
      : schedule;

  return res.status(200).json({ status: 200, rampSchedule: finalSchedule });
}

// ---------------------------------------------------------------------------
// PUT /experiments/:id/ramp-schedule  (update config)
// ---------------------------------------------------------------------------

const updateRampBody = z.object({
  name: z.string().min(1).optional(),
  steps: z.array(rampStep).optional(),
});

export async function putRampSchedule(
  req: AuthRequest<z.infer<typeof updateRampBody>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return res
      .status(404)
      .json({ status: 404, message: "Experiment not found" });
  }
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (!experiment.rampScheduleId) {
    return res.status(404).json({
      status: 404,
      message: "No ramp schedule attached to this experiment",
    });
  }

  const schedule = await context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  if (!schedule) {
    return res
      .status(404)
      .json({ status: 404, message: "Ramp schedule not found" });
  }

  const body = updateRampBody.parse(req.body);
  type ScheduleUpdate = Parameters<
    typeof context.models.rampSchedules.updateById
  >[1];
  const changes: ScheduleUpdate = {};
  if (body.name !== undefined) changes.name = body.name;
  if (body.steps !== undefined) {
    changes.steps = body.steps;
    // Editing steps on a running ramp can leave the playhead past the new last
    // step. Clamp currentStepIndex so the evaluator never indexes out of range.
    if (
      body.steps.length > 0 &&
      schedule.currentStepIndex >= body.steps.length
    ) {
      changes.currentStepIndex = body.steps.length - 1;
    }
  }
  // No startDate/cutoffDate here — experiment ramps source their dates from the
  // experiment's statusUpdateSchedule, not the schedule's own date fields.

  const updated = await context.models.rampSchedules.updateById(
    schedule.id,
    changes,
  );
  return res.status(200).json({ status: 200, rampSchedule: updated });
}

// ---------------------------------------------------------------------------
// DELETE /experiments/:id/ramp-schedule  (detach)
// ---------------------------------------------------------------------------

export async function deleteRampSchedule(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return res
      .status(404)
      .json({ status: 404, message: "Experiment not found" });
  }
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (!experiment.rampScheduleId) {
    return res.status(404).json({
      status: 404,
      message: "No ramp schedule attached",
    });
  }

  const schedule = await context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  // Only block deletion when the ramp is genuinely ramping a live experiment.
  // The stored status can be "running" on a draft experiment (it's frozen, not
  // advancing — the scheduler gates on experiment liveness), so use the derived
  // effective status rather than the raw stored value.
  if (
    schedule &&
    getEffectiveRampStatus(experiment.status, schedule) === "ramping"
  ) {
    return res.status(409).json({
      status: 409,
      message:
        "Cannot delete a running ramp schedule. Pause or rollback first.",
    });
  }

  if (schedule) {
    await context.models.rampSchedules.deleteById(schedule.id);
  }
  await updateExperiment({
    context,
    experiment,
    // Clear the reference with null, not undefined — Mongo's $set strips
    // undefined, which would leave a dangling rampScheduleId pointing at the
    // now-deleted schedule.
    changes: { rampScheduleId: null },
  });

  return res.status(200).json({ status: 200 });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/advance
// ---------------------------------------------------------------------------

export async function postAdvanceRamp(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule } = await loadScheduleOrFail(context, req.params.id, res);
  if (!schedule) return;

  if (schedule.status !== "running") {
    return res.status(409).json({
      status: 409,
      message: `Ramp schedule is not running (status: ${schedule.status})`,
    });
  }

  const now = new Date();
  const decision = await evaluateCurrentStep(context, schedule, now);
  const result = await applyRampEvaluationDecision(context, schedule, decision);
  if (!result.handled) {
    await advanceUntilBlocked(context, result.schedule, now);
  }

  const updated = await context.models.rampSchedules.getById(schedule.id);
  return res.status(200).json({
    status: 200,
    rampSchedule: updated,
    decision: decision.action,
  });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/rollback
// ---------------------------------------------------------------------------

const rollbackBody = z.object({
  reason: z.string().optional(),
  excludePreviouslyExposedUsers: z.boolean().optional(),
});

export async function postRollbackRamp(
  req: AuthRequest<z.infer<typeof rollbackBody>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule, experiment } = await loadScheduleOrFail(
    context,
    req.params.id,
    res,
  );
  if (!schedule || !experiment) return;

  const body = rollbackBody.parse(req.body);

  if (!["running", "paused"].includes(schedule.status)) {
    return res.status(409).json({
      status: 409,
      message: `Cannot rollback a ramp in status: ${schedule.status}`,
    });
  }

  // Mark rollback reason on schedule before applying so applyExperimentRollback can use it
  const withReason = await context.models.rampSchedules.updateById(
    schedule.id,
    {
      status: "rolled-back",
      lastRollbackAt: new Date(),
      lastRollbackReason: body.reason ?? "Manual rollback",
      nextStepAt: null,
      nextSnapshotAt: null,
      nextProcessAt: null,
    },
  );

  const updatedExperiment = await applyExperimentRollback(
    context,
    experiment,
    withReason,
  );

  // Optionally also bump minBucketVersion to exclude previously exposed users
  if (body.excludePreviouslyExposedUsers) {
    await updateExperiment({
      context,
      experiment: updatedExperiment,
      changes: {
        minBucketVersion: updatedExperiment.bucketVersion,
      },
    });
  }

  const updatedSchedule = await context.models.rampSchedules.getById(
    schedule.id,
  );
  return res.status(200).json({ status: 200, rampSchedule: updatedSchedule });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/pause
// ---------------------------------------------------------------------------

export async function postPauseRamp(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule } = await loadScheduleOrFail(context, req.params.id, res);
  if (!schedule) return;

  if (schedule.status !== "running") {
    return res.status(409).json({
      status: 409,
      message: `Ramp schedule is not running (status: ${schedule.status})`,
    });
  }

  const updated = await pauseSchedule(context, schedule, "Manual pause");
  return res.status(200).json({ status: 200, rampSchedule: updated });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/resume
// ---------------------------------------------------------------------------

export async function postResumeRamp(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule } = await loadScheduleOrFail(context, req.params.id, res);
  if (!schedule) return;

  if (schedule.status !== "paused") {
    return res.status(409).json({
      status: 409,
      message: `Ramp schedule is not paused (status: ${schedule.status})`,
    });
  }

  const updated = await resumeSchedule(context, schedule);
  return res.status(200).json({ status: 200, rampSchedule: updated });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/approve-step
// ---------------------------------------------------------------------------

const approveStepBody = z.object({
  context: z.enum(["ui", "api"]).optional(),
});

export async function postApproveRampStep(
  req: AuthRequest<z.infer<typeof approveStepBody>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule } = await loadScheduleOrFail(context, req.params.id, res);
  if (!schedule) return;

  const body = approveStepBody.parse(req.body);
  const err = await approveAndPublishStep(
    context,
    schedule,
    body.context ?? "ui",
  );
  if (err) {
    const detail = "detail" in err ? err.detail : err.code;
    return res.status(400).json({ status: 400, message: detail });
  }

  const updated = await context.models.rampSchedules.getById(schedule.id);
  return res.status(200).json({ status: 200, rampSchedule: updated });
}

// ---------------------------------------------------------------------------
// POST /experiments/:id/ramp-schedule/force-advance
// (skip all gates and immediately advance — manual override)
// ---------------------------------------------------------------------------

export async function postForceAdvanceRamp(
  req: AuthRequest<never, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { schedule } = await loadScheduleOrFail(context, req.params.id, res);
  if (!schedule) return;

  if (schedule.status !== "running" && schedule.status !== "paused") {
    return res.status(409).json({
      status: 409,
      message: `Cannot force-advance in status: ${schedule.status}`,
    });
  }

  const updatedSchedule = await advanceStep(context, schedule);
  await advanceUntilBlocked(context, updatedSchedule, new Date());

  const final = await context.models.rampSchedules.getById(schedule.id);
  return res.status(200).json({ status: 200, rampSchedule: final });
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

async function loadScheduleOrFail(
  context: ReturnType<typeof getContextFromReq>,
  experimentId: string,
  res: Response,
): Promise<{
  schedule: RampScheduleInterface | null;
  experiment: import("shared/validators").ExperimentInterface | null;
}> {
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) {
    res.status(404).json({ status: 404, message: "Experiment not found" });
    return { schedule: null, experiment: null };
  }
  if (!experiment.rampScheduleId) {
    res.status(404).json({
      status: 404,
      message: "No ramp schedule attached to this experiment",
    });
    return { schedule: null, experiment };
  }
  const schedule = await context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  if (!schedule) {
    res.status(404).json({ status: 404, message: "Ramp schedule not found" });
    return { schedule: null, experiment };
  }
  return { schedule, experiment };
}
