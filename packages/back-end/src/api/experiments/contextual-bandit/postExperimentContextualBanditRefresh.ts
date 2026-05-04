import { postExperimentContextualBanditRefreshValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { runContextualBanditSnapshot } from "back-end/src/jobs/runContextualBanditSnapshot";
import { createApiRequestHandler } from "back-end/src/util/handler";

/**
 * POST /experiments/:id/contextual-bandit/refresh
 *
 * Triggers a synchronous CB snapshot. Mirrors the dispatch in
 * `postExperimentSnapshot.ts` but exposed under the contextual-bandit
 * subroute so callers can keep CB-specific automation isolated from the
 * generic snapshot endpoint.
 */
export const postExperimentContextualBanditRefresh = createApiRequestHandler(
  postExperimentContextualBanditRefreshValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (!experiment.isContextualBandit) {
    throw new Error("Experiment is not a contextual bandit experiment");
  }
  if (!experiment.datasource) {
    throw new Error("No datasource set for experiment");
  }

  const datasource = await getDataSourceById(
    req.context,
    experiment.datasource,
  );
  if (!datasource) {
    throw new Error(
      `Could not find datasource for this experiment (datasource id: ${experiment.datasource})`,
    );
  }

  if (!req.context.permissions.canCreateExperimentSnapshot(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  if (experiment.status === "draft") {
    throw new Error(`Experiment is in draft state.`);
  }
  if (!experiment.phases.length) {
    throw new Error(`Experiment has no phases`);
  }

  const result = await runContextualBanditSnapshot({
    context: req.context,
    experiment,
    phaseIndex: experiment.phases.length - 1,
    opts: { reweight: !!req.body?.reweight },
  });

  return {
    contextualBanditEvent:
      req.context.models.contextualBanditEvents.toApi(result.event),
    weightsWereUpdated: result.weightsWereUpdated,
    ...(result.trimmedContexts && result.trimmedContexts.length
      ? { trimmedContexts: result.trimmedContexts }
      : {}),
    ...(result.warnings && result.warnings.length
      ? { warnings: result.warnings }
      : {}),
  };
});
