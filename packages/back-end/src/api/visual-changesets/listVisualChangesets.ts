import { listVisualChangesetsValidator } from "@back-end/src/validators/openapi";
import { ListVisualChangesetsResponse } from "@back-end/types/openapi";
import {
  findVisualChangesetsByExperiment,
  toVisualChangesetApiInterface,
} from "@back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const listVisualChangesets = createApiRequestHandler(
  listVisualChangesetsValidator
)(
  async (req): Promise<ListVisualChangesetsResponse> => {
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
