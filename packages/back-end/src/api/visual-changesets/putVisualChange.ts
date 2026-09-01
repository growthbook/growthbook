import { putVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireDraftExperiment } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";
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
  const orgId = req.organization.id;
  const payload = req.body;

  const visualChangeset = await findVisualChangesetById(changesetId, orgId);
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
      changesetId,
      visualChangeId,
      organization: orgId,
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
  requireDraftExperiment(req.context, experiment);

  const res = await updateVisualChange({
    changesetId,
    visualChangeId,
    organization: orgId,
    payload,
  });

  return res;
});
