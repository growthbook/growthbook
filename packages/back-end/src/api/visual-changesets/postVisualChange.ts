import uniqid from "uniqid";
import { postVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
} from "back-end/src/models/VisualChangesetModel";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator,
)(async (req) => {
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
  // The opt-in flag gates the write; it is not part of the visual change.
  const { allowRunningExperiment, ...body } = req.body;
  const auditLiveEdit = requireVisualChangeWrite(req, experiment, {
    allowRunning: !!allowRunningExperiment,
    visualChangesetId: req.params.id,
  });

  const visualChangeId = body.id ?? uniqid("vc_");

  const res = await createVisualChange(req.context, req.params.id, {
    ...body,
    id: visualChangeId,
    description: body.description ?? "",
    css: body.css ?? "",
    domMutations: body.domMutations ?? [],
  });
  await auditLiveEdit();

  return { ...res, visualChangeId };
});
