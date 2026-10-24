import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  countUnarchivedExperimentsByOrganization,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { queueExperimentQualityRecheck } from "back-end/src/jobs/experimentQualityScoreQueue";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";

function requireQualityScoreFeature(context: ReqContext) {
  if (!context.hasPremiumFeature("experiment-quality-score")) {
    context.throwPlanDoesNotAllowError(
      "Your organization does not have access to experiment quality scores",
    );
  }
}

// Re-runs the AI checks for every non-archived experiment in the org, even ones
// whose inputs haven't changed (e.g. after editing the AI prompt)
export async function postRecalculateExperimentQualityScores(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  await queueExperimentQualityRecheck({
    organization: context.org.id,
    force: true,
  });
  const queued = await countUnarchivedExperimentsByOrganization(context.org.id);
  return res.status(200).json({ status: 200, queued });
}

export async function getExperimentQualityScoreStatus(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);
  const experiments = await countUnarchivedExperimentsByOrganization(
    context.org.id,
  );
  return res.status(200).json({ status: 200, experiments });
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
  const qualityScoreOverride =
    score === null
      ? null
      : {
          score,
          userId: context.userId,
          userName: context.userName || undefined,
          dateOverridden: new Date(),
          reason: reason || undefined,
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
