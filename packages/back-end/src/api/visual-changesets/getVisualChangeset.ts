import { toExperimentApiInterface } from "@/src/services/experiments";
import { getVisualChangesetValidator } from "@/src/validators/openapi";
import { GetVisualChangesetResponse } from "@/types/openapi";
import { getExperimentById } from "@/src/models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "@/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
