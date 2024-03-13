import { toExperimentApiInterface } from "@back-end/src/services/experiments";
import { getVisualChangesetValidator } from "@back-end/src/validators/openapi";
import { GetVisualChangesetResponse } from "@back-end/types/openapi";
import { getExperimentById } from "@back-end/src/models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "@back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getVisualChangeset = createApiRequestHandler(
  getVisualChangesetValidator
)(
  async (req): Promise<GetVisualChangesetResponse> => {
    const { organization } = req;
    const { includeExperiment = 0 } = req.query;

    const visualChangeset = await findVisualChangesetById(
      req.params.id,
      organization.id
    );

    if (!visualChangeset) {
      throw new Error("Could not find visualChangeset with given ID");
    }

    const experiment =
      includeExperiment > 0
        ? await getExperimentById(req.context, visualChangeset.experiment)
        : null;

    const apiExperiment = experiment
      ? await toExperimentApiInterface(req.context, experiment)
      : null;

    return {
      visualChangeset: toVisualChangesetApiInterface(visualChangeset),
      ...(apiExperiment ? { experiment: apiExperiment } : {}),
    };
  }
);
