import { GetExperimentResultsResponse } from "shared/types/openapi";
import { getExperimentResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { toSnapshotApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req): Promise<GetExperimentResultsResponse> => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const phase = parseInt(req.query.phase ?? experiment.phases.length - 1 + "");

  const snapshot = await getLatestSnapshot({
    experiment: experiment.id,
    phase,
    dimension: req.query.dimension,
    withResults: true,
  });

  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }
  const metricGroups = await req.context.models.metricGroups.getAll();
  const result = toSnapshotApiInterface(experiment, snapshot, metricGroups);

  return {
    result: result,
  };
});
