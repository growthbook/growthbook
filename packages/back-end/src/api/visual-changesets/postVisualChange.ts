import { postVisualChangeValidator } from "@/src/validators/openapi";
import { PostVisualChangeResponse } from "@/types/openapi";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
} from "@/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
