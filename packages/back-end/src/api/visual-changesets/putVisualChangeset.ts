import { PutVisualChangesetResponse } from "../../../types/openapi";
import { updateVisualChangeset } from "../../models/VisualChangesetModel";
import { createApiRequestHandler } from "../../util/handler";
import { putVisualChangesetValidator } from "../../validators/openapi";

export const putVisualChangeset = createApiRequestHandler(
  putVisualChangesetValidator
)(
  async (req): Promise<PutVisualChangesetResponse> => {
    const res = await updateVisualChangeset({
      changesetId: req.params.id,
      organization: req.organization.id,
      updates: req.body,
    });

    return {
      nModified: res.nModified,
    };
  }
);
