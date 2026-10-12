import type { Response } from "express";
import { ExperimentQualityConfigBody } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getExperimentById,
  getStoppedExperimentIdsByOrganization,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { computeAndStoreAIQualityChecks } from "back-end/src/enterprise/services/experimentQualityScore";
import { queueExperimentQualityScoreUpdatesForOrg } from "back-end/src/jobs/updateExperimentQualityScores";
import { auditDetailsUpdate } from "back-end/src/services/audit";

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

// Lightweight status for the settings page (e.g. how many stopped
// experiments a recalculation would queue) without triggering anything
export async function getExperimentQualityScoreStatus(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);

  const stoppedExperiments = (
    await getStoppedExperimentIdsByOrganization(context.org.id)
  ).length;

  return res.status(200).json({
    status: 200,
    stoppedExperiments,
  });
}

// Set or clear the manual quality-score override for an experiment.
// Available to anyone who can update the experiment (experimenter+).
export async function postExperimentQualityScoreOverride(
  req: AuthRequest<{ score: number | null; reason?: string }, { id: string }>,
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
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  return res.status(200).json({
    status: 200,
    experiment: updated,
  });
}

// ---------------------------------------------------------------------------
// Config CRUD — named, shareable quality configs referenced by id from org
// and project settings. Permissions are enforced by the model.
// ---------------------------------------------------------------------------

export async function getExperimentQualityConfigs(
  req: AuthRequest,
  res: Response,
) {
  const context = getContextFromReq(req);
  return res.status(200).json({
    status: 200,
    configs: await context.models.experimentQualityConfigs.getAll(),
  });
}

type ConfigWriteBody = {
  name: string;
  description?: string;
} & ExperimentQualityConfigBody;

export async function postExperimentQualityConfig(
  req: AuthRequest<ConfigWriteBody>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const {
    name,
    description,
    aiChecksEnabled,
    sections,
    checks,
    customAiChecks,
  } = req.body;
  const config = await context.models.experimentQualityConfigs.create({
    name,
    description,
    aiChecksEnabled,
    sections,
    checks,
    customAiChecks,
  });
  return res.status(200).json({ status: 200, config });
}

export async function putExperimentQualityConfig(
  req: AuthRequest<Partial<ConfigWriteBody>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const existing = await context.models.experimentQualityConfigs.getById(
    req.params.id,
  );
  if (!existing) {
    return res.status(404).json({
      status: 404,
      message: "Could not find a quality config with that id",
    });
  }
  const {
    name,
    description,
    aiChecksEnabled,
    sections,
    checks,
    customAiChecks,
  } = req.body;
  const config = await context.models.experimentQualityConfigs.update(
    existing,
    {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      aiChecksEnabled,
      sections,
      checks,
      customAiChecks,
    },
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
    return res.status(404).json({
      status: 404,
      message: "Could not find a quality config with that id",
    });
  }
  await context.models.experimentQualityConfigs.delete(existing);
  return res.status(200).json({ status: 200 });
}
