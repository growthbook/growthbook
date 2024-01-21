import { PostVisualChangeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
} from "../../models/VisualChangesetModel";
import { postVisualChangeValidator } from "../../validators/openapi";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator
)(
  async (req): Promise<PostVisualChangeResponse> => {
    const experiment = await findExperimentByVisualChangesetId(
      req.params.id,
      req.organization.id
    );

    if (!experiment) {
      throw new Error("Experiment not found");
    }

    req.checkPermissions("createAnalyses", experiment.project);

    const res = await createVisualChange(
      req.params.id,
      req.organization.id,
      req.body
    );

    return res;
  }
);
