import { getVisualChangesetValidator } from "shared/validators";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveChangesetOwner } from "back-end/src/services/changesetOwner";

export const getVisualChangeset = createApiRequestHandler(
  getVisualChangesetValidator,
)(async (req) => {
  const { organization } = req;
  const { includeExperiment = 0 } = req.query;

  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    organization.id,
  );

  if (!visualChangeset) {
    throw new Error("Could not find visualChangeset with given ID");
  }

  const owner =
    includeExperiment > 0
      ? await resolveChangesetOwner(req.context, visualChangeset)
      : null;
  const experiment = owner ? await owner.toEditorExperiment() : null;

  return {
    visualChangeset: toVisualChangesetApiInterface(visualChangeset),
    ...(experiment ? { experiment } : {}),
  };
});
