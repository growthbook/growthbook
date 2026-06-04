import type { Response } from "express";
import { getAffectedEnvsForExperiment } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import {
  getContextualBanditResultsForUi,
  runContextualBanditSnapshot,
} from "back-end/src/enterprise/services/contextualBandits";

// 30 min. Duplicates `SNAPSHOT_TIMEOUT` from controllers/experiments.ts
// because cross-controller imports are forbidden by lint.
const CB_REFRESH_TIMEOUT_MS = 30 * 60 * 1000;

/** GET /experiment/:id/contextual-bandit/results — latest CB results + status for the UI. */
export async function getContextualBanditResults(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("contextual-bandits")) {
    res.status(402).json({
      status: 402,
      message: "Contextual Bandits require an Enterprise plan.",
    });
    return;
  }
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }
  if (experiment.organization !== context.org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to view this experiment",
    });
    return;
  }
  if (!context.permissions.canReadSingleProjectResource(experiment.project)) {
    context.permissions.throwPermissionError();
  }

  // URL still carries an experiment id; resolve the paired CB before delegating.
  const cb = await context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    res.status(200).json({
      status: 200,
      contextualBanditSnapshot: null,
      latest: null,
    });
    return;
  }
  const results = await getContextualBanditResultsForUi(context, cb);

  res.status(200).json({
    status: 200,
    ...results,
  });
}

/** POST /experiment/:id/contextual-bandit/refresh — UI-triggered CB snapshot refresh. */
export async function postContextualBanditRefresh(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("contextual-bandits")) {
    res.status(402).json({
      status: 402,
      message: "Contextual Bandits require an Enterprise plan.",
    });
    return;
  }
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }
  if (!experiment.phases.length) {
    res.status(400).json({
      status: 400,
      message: "Experiment has no phases",
    });
    return;
  }

  // Gate on canRunExperiment (project/env); the datasource check below is additive.
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
  });
  if (!context.permissions.canRunExperiment(experiment, envs)) {
    context.permissions.throwPermissionError();
  }

  const datasource = experiment.datasource
    ? await getDataSourceById(context, experiment.datasource)
    : null;
  if (!datasource) {
    res.status(400).json({
      status: 400,
      message: "Could not find datasource for this experiment",
    });
    return;
  }
  if (!context.permissions.canRunExperimentQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const phase = experiment.phases.length - 1;
  req.setTimeout(CB_REFRESH_TIMEOUT_MS);

  // URL has an experiment id; resolve the paired CB before handing off.
  const cb = await context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    res.status(404).json({
      status: 404,
      message: "No contextual bandit found for this experiment",
    });
    return;
  }

  try {
    const result = await runContextualBanditSnapshot(context, cb, phase, {
      triggeredBy: "manual",
    });

    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        phase,
        snapshotId: result.snapshotId,
        cbeId: result.cbeId,
      }),
    });

    res.status(200).json({
      status: 200,
      snapshotId: result.snapshotId,
      cbeId: result.cbeId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({
      status: 400,
      message,
    });
  }
}
