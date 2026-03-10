import { PostVisualChangeResponse } from "shared/types/openapi";
import { postVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
} from "back-end/src/models/VisualChangesetModel";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator,
)(async (req): Promise<PostVisualChangeResponse> => {
  const experiment = await findExperimentByVisualChangesetId(
    req.context,
    req.params.id,
  );

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (!req.context.permissions.canCreateVisualChange(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const res = await createVisualChange(
    req.params.id,
    req.organization.id,
    req.body,
  );

  return res;
});
