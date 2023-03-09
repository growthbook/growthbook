import { GetVisualChangesetResponse } from "../../../types/openapi";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { getVisualChangesetValidator } from "../../validators/openapi";

export const getVisualChangeset = createApiRequestHandler(
  getVisualChangesetValidator
)(
  async (req): Promise<GetVisualChangesetResponse> => {
    const visualChangeset = await findVisualChangesetById(
      req.params.id,
      req.organization.id
    );
    if (!visualChangeset) {
      throw new Error("Could not find visualChangeset with that id");
    }

    return {
      visualChangeset: toVisualChangesetApiInterface(visualChangeset),
    };
  }
);
