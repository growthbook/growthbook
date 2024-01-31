import { ListVisualChangesetsResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import {
  findVisualChangesetsByExperiment,
  toVisualChangesetApiInterface,
} from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { listVisualChangesetsValidator } from "../../validators/openapi";

export const listVisualChangesets = createApiRequestHandler(
  listVisualChangesetsValidator
)(
  async (req): Promise<ListVisualChangesetsResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);

    req.checkPermissions("manageVisualChanges", experiment?.project);

    const visualChangesets = await findVisualChangesetsByExperiment(
      req.params.id,
      req.organization.id
    );

    return {
      visualChangesets: visualChangesets.map((visualChangeset) =>
        toVisualChangesetApiInterface(visualChangeset)
      ),
    };
  }
);
