import omit from "lodash/omit";
import { putVisualChangesetValidator } from "shared/validators";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
  VisualChangesetUpdates,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";

export const putVisualChangeset = createApiRequestHandler(
  putVisualChangesetValidator,
)(async (req) => {
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const updates: VisualChangesetUpdates = {
    ...omit(req.body, ["urlPatterns", "allowRunningExperiment"]),
    ...(req.body.urlPatterns !== undefined
      ? {
          urlPatterns: req.body.urlPatterns.map((p) => ({
            type: p.type,
            pattern: p.pattern,
            include: p.include ?? true,
          })),
        }
      : {}),
  };

  const owner = await resolveChangesetOwner(req.context, visualChangeset);
  if (!owner) {
    throw new Error(ownerNotFoundMessage(visualChangeset));
  }
  if (!owner.canUpdateVisualChange()) {
    req.context.permissions.throwPermissionError();
  }
  // Re-checked on every save so a stale editor can't clobber a test started since it loaded.
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: !!req.body.allowRunningExperiment,
    visualChangesetId: visualChangeset.id,
  });

  const res = await updateVisualChangeset({
    visualChangeset,
    owner,
    context: req.context,
    updates,
  });
  await auditLiveEdit();

  const updatedVisualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );

  return {
    nModified: res.nModified,
    visualChangeset: updatedVisualChangeset
      ? toVisualChangesetApiInterface(updatedVisualChangeset)
      : toVisualChangesetApiInterface(visualChangeset),
  };
});
