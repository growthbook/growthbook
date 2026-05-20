import { getExperimentResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
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

  const snapshot = await getLatestSnapshot({
    context: req.context,
    experiment: experiment.id,
    phase,
    dimension: req.query.dimension,
    withResults: true,
  });

  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }

  const [apiExperiment, metricMap] = await Promise.all([
    toExperimentApiInterface(req.context, experiment),
    getMetricMap(req.context),
  ]);
  const result = toSnapshotApiInterface(experiment, snapshot, metricMap);

  return {
    experiment: apiExperiment,
    result,
  };
});
