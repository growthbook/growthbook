import { putVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import {
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

  const owner = await resolveChangesetOwner(req.context, visualChangeset);
  if (!owner) {
    throw new Error(ownerNotFoundMessage());
  }
  if (!owner.canUpdateVisualChange()) {
    req.context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: !!allowRunningExperiment,
    visualChangesetId: changesetId,
  });

  const res = await updateVisualChange({
    context: req.context,
    owner,
    changesetId,
    visualChangeId,
    payload,
  });
  await auditLiveEdit();

  return res;
});
