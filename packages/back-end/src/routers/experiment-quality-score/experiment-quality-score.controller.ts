import type { Response } from "express";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { ExperimentQualityConfigInterface } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  countStoppedExperimentsByOrganization,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { queueExperimentQualityScoreUpdatesForOrg } from "back-end/src/jobs/updateExperimentQualityScores";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";

function requireQualityScoreFeature(context: ReqContext) {
  if (!context.hasPremiumFeature("experiment-quality-score")) {
    context.throwPlanDoesNotAllowError(
      "Your organization does not have access to experiment quality scores",
    );
  }
}

// Re-runs the AI checks for every stopped experiment in the org, even ones
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

  const queued = await queueExperimentQualityScoreUpdatesForOrg(
    context.org.id,
    { force: true },
  );
  return res.status(200).json({ status: 200, queued });
}

export async function getExperimentQualityScoreStatus(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);
  const stoppedExperiments = await countStoppedExperimentsByOrganization(
    context.org.id,
  );
  return res.status(200).json({ status: 200, stoppedExperiments });
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

// Named, shareable quality configs. Permissions are enforced by the model.

export async function postExperimentQualityConfig(
  req: AuthRequest<CreateProps<ExperimentQualityConfigInterface>>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const config = await context.models.experimentQualityConfigs.create(req.body);
  return res.status(200).json({ status: 200, config });
}

// Only the fields sent change, so a rename can send just the name
export async function putExperimentQualityConfig(
  req: AuthRequest<
    UpdateProps<ExperimentQualityConfigInterface>,
    { id: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const existing = await context.models.experimentQualityConfigs.getById(
    req.params.id,
  );
  if (!existing) {
    return context.throwNotFoundError("Could not find that configuration");
  }
  const config = await context.models.experimentQualityConfigs.update(
    existing,
    req.body,
  );
  return res.status(200).json({ status: 200, config });
}

export async function deleteExperimentQualityConfig(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const existing = await context.models.experimentQualityConfigs.getById(
    req.params.id,
  );
  if (!existing) {
    return context.throwNotFoundError("Could not find that configuration");
  }
  await context.models.experimentQualityConfigs.delete(existing);
  return res.status(200).json({ status: 200 });
}
