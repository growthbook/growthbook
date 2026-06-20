import type { Response } from "express";
import { z } from "zod";
import {
  RampScheduleInterface,
  RampStepAction,
  rampStep,
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
    startDate: z.iso.datetime().nullish(),
    cutoffDate: z.iso.datetime().nullish(),
  })
  .refine((d) => (d.steps !== undefined) !== (d.templateId !== undefined), {
    message: "Provide exactly one of steps or templateId",
  });

export async function postRampSchedule(
  req: AuthRequest<z.infer<typeof attachRampBody>, { id: string }>,
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
  if (experiment.rampScheduleId) {
    return res.status(409).json({
      status: 409,
      message:
        "This experiment already has a ramp schedule. Delete the existing one first.",
    });
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

  // A schedule with no steps only makes sense as a pure date-gated rollout;
  // without a start or cutoff date it would never run. Reject rather than
  // create an unbootable schedule that also blocks future attaches.
  const startAt = body.startDate ? new Date(body.startDate) : null;
  const cutoffAt = body.cutoffDate ? new Date(body.cutoffDate) : null;
  if (steps.length === 0 && !startAt && !cutoffAt) {
    return res.status(400).json({
      status: 400,
      message:
        "Ramp schedule has no steps. Provide a startDate or cutoffDate, or a template with steps.",
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
    startDate: startAt,
    cutoffDate: cutoffAt,
    status: "ready" as const,
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: null,
  });

  try {
    await updateExperiment({
      context,
      experiment,
      changes: { rampScheduleId: schedule.id },
    });
  } catch (e) {
    // Don't leave an orphaned schedule the experiment doesn't point at (and
    // which would let a retry create a second one).
    await context.models.rampSchedules.delete(schedule);
    throw e;
  }

  // Start immediately when there's no future start date — experiment ramps have
  // no revision-publish trigger (unlike feature ramps via
  // onActivatingRevisionPublished), so a "ready" schedule would otherwise never
  // be picked up by the agenda job.
  const finalSchedule =
    !startAt || startAt <= new Date()
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
  startDate: z.iso.datetime().nullish(),
  cutoffDate: z.iso.datetime().nullish(),
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
  if (body.steps !== undefined) changes.steps = body.steps;
  if ("startDate" in body)
    changes.startDate = body.startDate ? new Date(body.startDate) : null;
  if ("cutoffDate" in body)
    changes.cutoffDate = body.cutoffDate ? new Date(body.cutoffDate) : null;

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
  if (schedule && schedule.status === "running") {
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
    changes: { rampScheduleId: undefined },
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
