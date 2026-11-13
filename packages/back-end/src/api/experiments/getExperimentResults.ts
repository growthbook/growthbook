import {
  ExperimentInterfaceExcludingHoldouts,
  getExperimentResultsValidator,
} from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getHealthSettingsForOrg,
  getMetricMapForExperiment,
  toExperimentApiInterface,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExposureQueriesForDatasource } from "back-end/src/services/assignmentQuerySelection";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";
import { toApiResultHealth } from "./resultHealth";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new NotFoundError("Could not find experiment with that id");
  }

  const latestPhase = experiment.phases.length - 1;
  const phase = parseInt(req.query.phase ?? latestPhase + "");

  const snapshot = await getLatestSuccessfulSnapshot({
    context: req.context,
    experiment: experiment.id,
    phase,
    dimension: req.query.dimension,
  });

  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }

  const [apiExperiment, metricsById, exposureQueries] = await Promise.all([
    // Holdouts have no enhanced status. Non-holdout requests do have enhanced status
    // but we should not return it if the user requested data from an older phase
    // where that enhanced status does not apply.
    experiment.type === "holdout" || phase !== latestPhase
      ? toExperimentApiInterface(req.context, experiment).then((apiDoc) =>
          resolveOwnerEmail(apiDoc, req.context),
        )
      : toEnhancedExperimentApiResponse(
          req.context,
          experiment as ExperimentInterfaceExcludingHoldouts,
        ),
    getMetricMapForExperiment(req.context, experiment),
    getExposureQueriesForDatasource(req.context, experiment.datasource),
  ]);
  const result = toSnapshotApiInterface(
    experiment,
    snapshot,
    metricsById,
    exposureQueries,
  );

  return {
    experiment: apiExperiment,
    result: {
      ...result,
      health: toApiResultHealth({
        experiment,
        snapshot,
        healthSettings: getHealthSettingsForOrg(req.context),
      }),
    },
  };
});
