import { listVisualChangesetsValidator } from "shared/validators";
import {
  findVisualChangesetsByExperiment,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listVisualChangesets = createApiRequestHandler(
  listVisualChangesetsValidator,
)(async (req) => {
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
