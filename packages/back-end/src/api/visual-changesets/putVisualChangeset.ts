import { PutVisualChangesetResponse } from "../../../types/openapi";
import { VisualChangesetInterface } from "../../../types/visual-changeset";
import { getExperimentById } from "../../models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { putVisualChangesetValidator } from "../../validators/openapi";

export const putVisualChangeset = createApiRequestHandler(
  putVisualChangesetValidator,
)(async (req): Promise<PutVisualChangesetResponse> => {
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    req.context,
    visualChangeset.experiment,
  );

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (!req.context.permissions.canUpdateVisualChange(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const res = await updateVisualChangeset({
    visualChangeset,
    experiment,
    context: req.context,
    updates: req.body,
  });

  const updatedVisualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );

  return {
    nModified: res.nModified,
    visualChangeset: updatedVisualChangeset
      ? toVisualChangesetApiInterface(updatedVisualChangeset)
      : {
          ...toVisualChangesetApiInterface(visualChangeset),
          ...(req.body as Partial<VisualChangesetInterface>),
        },
  };
});
