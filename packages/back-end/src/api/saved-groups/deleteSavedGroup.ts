import { deleteSavedGroupValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSavedGroup = createApiRequestHandler(
  deleteSavedGroupValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.id,
  );

  if (!savedGroup) {
    throw new Error("Unable to delete saved group. No group found.");
  }

  if (!req.context.permissions.canDeleteSavedGroup(savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  // Match the internal controller: archive-then-delete. Archive is reversible
  // and flows through the approval system; delete bypasses approval but is
  // gated on the archive having already been published.
  if (!savedGroup.archived) {
    throw new Error("Saved group must be archived before it can be deleted");
  }

  await req.context.models.savedGroups.deleteById(req.params.id);

  return {
    deletedId: req.params.id,
  };
});
