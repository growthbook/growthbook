import { PostVisualChangeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { createVisualChange } from "../../models/VisualChangesetModel";
import { postVisualChangeValidator } from "../../validators/openapi";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator
)(
  async (req): Promise<PostVisualChangeResponse> => {
    const visualChange = await createVisualChange(
      req.params.id,
      req.organization.id,
      req.body
    );

    return {
      visualChange,
    };
  }
);
