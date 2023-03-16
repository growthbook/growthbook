import { PutVisualChangeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateVisualChange } from "../../models/VisualChangesetModel";
import { putVisualChangeValidator } from "../../validators/openapi";

export const putVisualChange = createApiRequestHandler(
  putVisualChangeValidator
)(
  async (req): Promise<PutVisualChangeResponse> => {
    const changesetId = req.params.id;
    const visualChangeId = req.params.visualChangeId;
    const orgId = req.organization.id;
    const payload = req.body;

    const res = await updateVisualChange({
      changesetId,
      visualChangeId,
      organization: orgId,
      payload,
    });

    return res;
  }
);
