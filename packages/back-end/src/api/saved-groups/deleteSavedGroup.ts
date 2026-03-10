import { DeleteSavedGroupResponse } from "shared/types/openapi";
import { deleteSavedGroupValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSavedGroup = createApiRequestHandler(
  deleteSavedGroupValidator,
)(async (req): Promise<DeleteSavedGroupResponse> => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.id,
  );

  if (!savedGroup) {
    throw new Error("Unable to delete saved group. No group found.");
  }

  if (!req.context.permissions.canDeleteSavedGroup(savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  await req.context.models.savedGroups.deleteById(req.params.id);

  return {
    deletedId: req.params.id,
  };
});
