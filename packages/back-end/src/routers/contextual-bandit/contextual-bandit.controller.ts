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

// 30 minutes. Matches `SNAPSHOT_TIMEOUT` in controllers/experiments.ts —
// duplicated rather than imported because the lint rules forbid one
// controller importing from another.
const CB_REFRESH_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * GET /experiment/:id/contextual-bandit/results
 * Latest contextual bandit results + status for the UI results tab.
 */
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

  // The results helper takes a CB directly post-PR-8 Commit 2. The
  // controller URL still carries an experiment id; resolve the paired
  // CB before delegating. PR-8 Commit 4 dropped the
  // `"contextual-bandit"` experimentType check above because the enum
  // value is gone; the CB lookup itself is the gate now.
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

/**
 * POST /experiment/:id/contextual-bandit/refresh
 * Trigger a contextual bandit snapshot refresh (UI-triggered).
 */
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

  // Refresh = running the bandit, so gate on canRunExperiment first. The
  // datasource-level canRunExperimentQueries check below is additive (data
  // access), not a substitute for project/env access on the experiment.
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

  // The orchestrator now takes the CB directly; this legacy controller
  // still receives an experiment id from the URL (`/experiment/:id/...`),
  // so resolve the paired CB via the FK before handing off. The whole
  // controller is deleted in PR-8 Commit 6 once the front-end stops
  // calling the legacy path.
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
