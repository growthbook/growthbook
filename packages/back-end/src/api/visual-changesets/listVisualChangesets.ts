import { listVisualChangesetsValidator } from "@/src/validators/openapi";
import { ListVisualChangesetsResponse } from "@/types/openapi";
import {
  findVisualChangesetsByExperiment,
  toVisualChangesetApiInterface,
} from "@/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
