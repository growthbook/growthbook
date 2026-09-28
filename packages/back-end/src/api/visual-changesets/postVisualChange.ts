import uniqid from "uniqid";
import { postVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";
import { requireCbEditable } from "back-end/src/api/visual-editor-ai/requireCbEditable";
import {
  createVisualChange,
  findExperimentByVisualChangesetId,
  findVisualChangesetById,
} from "back-end/src/models/VisualChangesetModel";

export const postVisualChange = createApiRequestHandler(
  postVisualChangeValidator,
)(async (req) => {
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  // The opt-in flag gates the write; it is not part of the visual change.
  const { allowRunningExperiment, ...body } = req.body;

  if (visualChangeset.contextualBandit) {
    const cb = await req.context.models.contextualBandits.getById(
      visualChangeset.contextualBandit,
    );
    if (!cb) {
      throw new Error("Contextual Bandit not found");
    }
    if (!req.context.permissions.canUpdateContextualBandit(cb, cb)) {
      req.context.permissions.throwPermissionError();
    }
    requireCbEditable(req.context, cb);

    const visualChangeId = body.id ?? uniqid("vc_");
    const res = await createVisualChange(req.context, req.params.id, {
      ...body,
      id: visualChangeId,
      description: body.description ?? "",
      css: body.css ?? "",
      domMutations: body.domMutations ?? [],
    });
    return { ...res, visualChangeId };
  }

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
