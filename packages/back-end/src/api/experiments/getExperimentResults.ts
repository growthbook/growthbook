import { toSnapshotApiInterface } from "@back-end/src/services/experiments";
import { getExperimentResultsValidator } from "@back-end/src/validators/openapi";
import { GetExperimentResultsResponse } from "@back-end/types/openapi";
import { getExperimentById } from "@back-end/src/models/ExperimentModel";
import { getLatestSnapshot } from "@back-end/src/models/ExperimentSnapshotModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator
)(
  async (req): Promise<GetExperimentResultsResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const phase = parseInt(
      req.query.phase ?? experiment.phases.length - 1 + ""
    );

    const snapshot = await getLatestSnapshot(
      experiment.id,
      phase,
      req.query.dimension,
      true
    );
    if (!snapshot) {
      throw new Error("No results found for that experiment");
    }

    const result = toSnapshotApiInterface(experiment, snapshot);

    return {
      result: result,
    };
  }
);
