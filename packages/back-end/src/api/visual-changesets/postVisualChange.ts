import { postVisualChangeValidator } from "@back-end/src/validators/openapi";
import { PostVisualChangeResponse } from "@back-end/types/openapi";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
} from "@back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator
)(
  async (req): Promise<PostVisualChangeResponse> => {
    const experiment = await findExperimentByVisualChangesetId(
      req.context,
      req.params.id
    );

    if (!experiment) {
      throw new Error("Experiment not found");
    }

    req.checkPermissions("manageVisualChanges", experiment.project);

    const res = await createVisualChange(
      req.params.id,
      req.organization.id,
      req.body
    );

    return res;
  }
);
