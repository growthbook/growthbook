import { putVisualChangesetValidator } from "@back-end/src/validators/openapi";
import { PutVisualChangesetResponse } from "@back-end/types/openapi";
import { VisualChangesetInterface } from "@back-end/types/visual-changeset";
import { getExperimentById } from "@back-end/src/models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "@back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const putVisualChangeset = createApiRequestHandler(
  putVisualChangesetValidator
)(
  async (req): Promise<PutVisualChangesetResponse> => {
    const visualChangeset = await findVisualChangesetById(
      req.params.id,
      req.organization.id
    );
    if (!visualChangeset) {
      throw new Error("Visual Changeset not found");
    }

    const experiment = await getExperimentById(
      req.context,
      visualChangeset.experiment
    );

    if (!experiment) {
      throw new Error("Experiment not found");
    }

    req.checkPermissions("manageVisualChanges", experiment.project);

    const res = await updateVisualChangeset({
      visualChangeset,
      experiment,
      context: req.context,
      updates: req.body,
    });

    const updatedVisualChangeset = await findVisualChangesetById(
      req.params.id,
      req.organization.id
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
  }
);
