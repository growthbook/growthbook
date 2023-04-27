import { PutVisualChangesetResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import {
  findVisualChangesetById,
  updateVisualChangeset,
} from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { putVisualChangesetValidator } from "../../validators/openapi";

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
      req.organization.id,
      visualChangeset.experiment
    );

    const res = await updateVisualChangeset({
      visualChangeset,
      experiment,
      organization: req.organization,
      updates: req.body,
      user: req.eventAudit,
    });

    return {
      nModified: res.nModified,
    };
  }
);
