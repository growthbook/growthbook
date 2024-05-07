import { GetExperimentResultsResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import { getLatestSnapshot } from "../../models/ExperimentSnapshotModel";
import { toSnapshotApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { getExperimentResultsValidator } from "../../validators/openapi";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req): Promise<GetExperimentResultsResponse> => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const phase = parseInt(req.query.phase ?? experiment.phases.length - 1 + "");

  const snapshot = await getLatestSnapshot(
    experiment.id,
    phase,
    req.query.dimension,
    true,
  );
  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }

  const result = toSnapshotApiInterface(experiment, snapshot);

  return {
    result: result,
  };
});
