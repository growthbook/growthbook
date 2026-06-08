import { getExperimentResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getMetricMapForExperiment,
  toExperimentApiInterface,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const phase = parseInt(req.query.phase ?? experiment.phases.length - 1 + "");

  const snapshot = await getLatestSuccessfulSnapshot({
    context: req.context,
    experiment: experiment.id,
    phase,
    dimension: req.query.dimension,
  });

  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }

  const [apiExperiment, metricsById] = await Promise.all([
    toExperimentApiInterface(req.context, experiment),
    getMetricMapForExperiment(req.context, experiment),
  ]);
  const result = toSnapshotApiInterface(experiment, snapshot, metricsById);

  return {
    experiment: apiExperiment,
    result,
  };
});
