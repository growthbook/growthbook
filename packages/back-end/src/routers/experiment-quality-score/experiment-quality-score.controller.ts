import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { computeAndStoreAIQualityChecks } from "back-end/src/enterprise/services/experimentQualityScore";
import { queueExperimentQualityScoreUpdatesForOrg } from "back-end/src/jobs/updateExperimentQualityScores";

// Recompute the AI quality checks for one experiment, bypassing the
// inputs-hash cache (used by the manual refresh action in the UI)
export async function postRefreshExperimentQualityScore(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("experiment-quality-score")) {
    return res.status(403).json({
      status: 403,
      message:
        "Organization does not have the experiment quality score feature",
    });
  }

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  const updated = await computeAndStoreAIQualityChecks({
    context,
    experiment,
    force: true,
  });

  return res.status(200).json({
    status: 200,
    experiment: updated ?? experiment,
  });
}

// Enqueue AI quality-check updates for every stopped experiment in the org
// (used after quality-score settings change). Runs through the job queue —
// per-experiment jobs re-check gates and skip fresh results.
export async function postRecalculateExperimentQualityScores(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("experiment-quality-score")) {
    return res.status(403).json({
      status: 403,
      message:
        "Organization does not have the experiment quality score feature",
    });
  }

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const queued = await queueExperimentQualityScoreUpdatesForOrg(context.org.id);

  return res.status(200).json({
    status: 200,
    queued,
  });
}
