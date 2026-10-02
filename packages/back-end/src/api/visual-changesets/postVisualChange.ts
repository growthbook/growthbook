import uniqid from "uniqid";
import { postVisualChangeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import {
  createVisualChange,
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

  const owner = await resolveChangesetOwner(req.context, visualChangeset);
  if (!owner) {
    throw new Error(ownerNotFoundMessage());
  }
  if (!owner.canUpdateVisualChange()) {
    req.context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: !!allowRunningExperiment,
    visualChangesetId: req.params.id,
  });

  const visualChangeId = body.id ?? uniqid("vc_");

  const res = await createVisualChange(
    req.context,
    req.params.id,
    {
      ...body,
      id: visualChangeId,
      description: body.description ?? "",
      css: body.css ?? "",
      domMutations: body.domMutations ?? [],
    },
    owner,
  );
  await auditLiveEdit();

  return { ...res, visualChangeId };
});
