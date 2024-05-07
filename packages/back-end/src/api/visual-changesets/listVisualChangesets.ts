import { ListVisualChangesetsResponse } from "../../../types/openapi";
import {
  findVisualChangesetsByExperiment,
  toVisualChangesetApiInterface,
} from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { listVisualChangesetsValidator } from "../../validators/openapi";

export const listVisualChangesets = createApiRequestHandler(
  listVisualChangesetsValidator,
)(async (req): Promise<ListVisualChangesetsResponse> => {
  const visualChangesets = await findVisualChangesetsByExperiment(
    req.params.id,
    req.organization.id,
  );

  return {
    visualChangesets: visualChangesets.map((visualChangeset) =>
      toVisualChangesetApiInterface(visualChangeset),
    ),
  };
});
