import { PutVisualChangeResponse } from "shared/types/openapi";
import { putVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  findExperimentByVisualChangesetId,
  updateVisualChange,
} from "back-end/src/models/VisualChangesetModel";

export const putVisualChange = createApiRequestHandler(
  putVisualChangeValidator,
)(async (req): Promise<PutVisualChangeResponse> => {
  const changesetId = req.params.id;
  const visualChangeId = req.params.visualChangeId;
  const orgId = req.organization.id;
  const payload = req.body;

  const experiment = await findExperimentByVisualChangesetId(
    req.context,
    changesetId,
  );

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (!req.context.permissions.canUpdateVisualChange(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const res = await updateVisualChange({
    changesetId,
    visualChangeId,
    organization: orgId,
    payload,
  });

  return res;
});
