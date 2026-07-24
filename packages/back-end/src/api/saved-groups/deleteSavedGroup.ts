import { deleteSavedGroupValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { assertSavedGroupDeletable } from "back-end/src/services/savedGroups";

export const deleteSavedGroup = createApiRequestHandler(
  deleteSavedGroupValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.id,
  );

  if (!savedGroup) {
    throw new NotFoundError("Unable to delete saved group. No group found.");
  }

  if (!req.context.permissions.canDeleteSavedGroup(savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  // Match the internal controller: archive-then-delete. Archive is reversible
  // and flows through the approval system; delete bypasses approval but is
  // gated on the archive having already been published — unless the org has
  // opted into unrestricted REST writes (mirrors feature deletion).
  if (!savedGroup.archived && !canUseRestApiBypassSetting(req)) {
    throw new BadRequestError(
      "Saved group must be archived before it can be deleted via the REST API, " +
        "or enable 'REST API always bypasses approval requirements' in organization settings.",
    );
  }

  // Reference integrity: a dangling group id silently flips live targeting, so
  // block regardless of archived state or REST bypass (that setting covers
  // approval, not integrity).
  await assertSavedGroupDeletable(req.context, req.params.id);

  await req.context.models.savedGroups.deleteById(req.params.id);

  return {
    deletedId: req.params.id,
  };
});
