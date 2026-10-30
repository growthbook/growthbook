import type { Response } from "express";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  countUnarchivedExperimentsByProject,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  queueExperimentQualityRecheck,
  queueExperimentQualityScoreUpdate,
} from "back-end/src/jobs/experimentQualityScoreQueue";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";
import { isDecisionModelConfigured } from "back-end/src/enterprise/services/decisionModel";

function requireQualityScoreFeature(context: ReqContext) {
  if (!context.hasPremiumFeature("experiment-quality-score")) {
    context.throwPlanDoesNotAllowError(
      "Your organization does not have access to experiment quality scores",
    );
  }
}

// Re-runs the AI checks even where the inputs haven't changed (e.g. after
// editing the AI settings): for one Project, the experiments following the
// organization default, or the whole organization
export async function postRecalculateExperimentQualityScores(
  req: AuthRequest<{ project?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);
  const { project } = req.body;
  if (
    project
      ? !context.permissions.canUpdateProject(project)
      : !context.permissions.canManageOrgSettings()
  ) {
    context.permissions.throwPermissionError();
  }

  await queueExperimentQualityRecheck({
    organization: context.org.id,
    force: true,
    ...(project ? { project } : {}),
    ...(project === ORG_DEFAULT_SCOPE ? { inheritingOnly: true } : {}),
  });
  return res.status(200).json({ status: 200 });
}

export async function getExperimentQualityScoreStatus(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);
  const experimentsByProject = await countUnarchivedExperimentsByProject(
    context.org.id,
  );
  return res.status(200).json({
    status: 200,
    experiments: Object.values(experimentsByProject).reduce(
      (sum, n) => sum + n,
      0,
    ),
    // Unarchived experiments per Project id, with "" for no Project
    experimentsByProject,
    // Whether custom checks can be routed to the decision model
    decisionModelAvailable: isDecisionModelConfigured(),
  });
}

// Set or clear the manual quality-score override for an experiment.
// Available to anyone who can update the experiment (experimenter+).
export async function postExperimentQualityScoreOverride(
  req: AuthRequest<{ score: number | null; reason?: string }, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  const { score, reason } = req.body;
  if (score !== null && !reason) {
    context.throwBadRequestError("Add a reason for the override.");
  }
  const qualityScoreOverride =
    score === null
      ? null
      : {
          score,
          userId: context.userId,
          userName: context.userName || undefined,
          dateOverridden: new Date(),
          reason,
        };

  // No SDK payload impact, so skip webhooks; still audited below
  const updated = await updateExperiment({
    context,
    experiment,
    changes: { qualityScoreOverride },
    bypassWebhooks: true,
  });

  await context.auditLog({
    event: "experiment.update",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsUpdate(experiment, updated),
  });

  return res.status(200).json({ status: 200, experiment: updated });
}

// Re-runs one experiment's AI checks, even where its inputs haven't changed
export async function postRecheckExperimentQualityScore(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  await queueExperimentQualityScoreUpdate({
    experimentId: experiment.id,
    organization: context.org.id,
    force: true,
  });
  return res.status(200).json({ status: 200 });
}
