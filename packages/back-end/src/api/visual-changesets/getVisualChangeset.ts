import { GetVisualChangesetResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "../../models/VisualChangesetModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { getVisualChangesetValidator } from "../../validators/openapi";

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
      throw new Error("Could not find visualChangeset with that id");
    }

    const experiment =
      includeExperiment > 0
        ? await getExperimentById(organization.id, visualChangeset.experiment)
        : null;

    return {
      visualChangeset: toVisualChangesetApiInterface(visualChangeset),
      ...(experiment
        ? { experiment: toExperimentApiInterface(organization, experiment) }
        : {}),
    };
  }
);
