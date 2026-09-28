import { putVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";
import { requireCbEditable } from "back-end/src/api/visual-editor-ai/requireCbEditable";
import {
  findExperimentByVisualChangesetId,
  findVisualChangesetById,
  updateVisualChange,
} from "back-end/src/models/VisualChangesetModel";

export const putVisualChange = createApiRequestHandler(
  putVisualChangeValidator,
)(async (req) => {
  const changesetId = req.params.id;
  const visualChangeId = req.params.visualChangeId;
  // The opt-in flag gates the write; it is not part of the visual change.
  const { allowRunningExperiment, ...payload } = req.body;

  const visualChangeset = await findVisualChangesetById(
    changesetId,
    req.organization.id,
  );
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

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

    const res = await updateVisualChange({
      context: req.context,
      changesetId,
      visualChangeId,
      payload,
    });

    return res;
  }

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
  const auditLiveEdit = requireVisualChangeWrite(req, experiment, {
    allowRunning: !!allowRunningExperiment,
    visualChangesetId: changesetId,
  });

  const res = await updateVisualChange({
    context: req.context,
    changesetId,
    visualChangeId,
    payload,
  });
  await auditLiveEdit();

  return res;
});
