import { PutVisualChangeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import {
  findExperimentByVisualChangesetId,
  updateVisualChange,
} from "../../models/VisualChangesetModel";
import { putVisualChangeValidator } from "../../validators/openapi";

export const putVisualChange = createApiRequestHandler(
  putVisualChangeValidator
)(
  async (req): Promise<PutVisualChangeResponse> => {
    const changesetId = req.params.id;
    const visualChangeId = req.params.visualChangeId;
    const orgId = req.organization.id;
    const payload = req.body;

    const experiment = await findExperimentByVisualChangesetId(
      changesetId,
      orgId
    );

    if (!experiment) {
      throw new Error("Experiment not found");
    }

    req.checkPermissions("manageVisualChanges", experiment.project);

    const res = await updateVisualChange({
      changesetId,
      visualChangeId,
      organization: orgId,
      payload,
    });

    return res;
  }
);
