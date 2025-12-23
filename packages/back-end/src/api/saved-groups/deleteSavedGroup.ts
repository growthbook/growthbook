import { DeleteSavedGroupResponse } from "shared/types/openapi";
import { deleteSavedGroupValidator } from "shared/validators";
import {
  deleteSavedGroupById,
  getSavedGroupById,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSavedGroup = createApiRequestHandler(
  deleteSavedGroupValidator,
)(async (req): Promise<DeleteSavedGroupResponse> => {
  const savedGroup = await getSavedGroupById(
    req.params.id,
    req.organization.id,
  );

  if (!savedGroup) {
    throw new Error("Unable to delete saved group. No group found.");
  }

  if (!req.context.permissions.canDeleteSavedGroup(savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  await deleteSavedGroupById(req.params.id, req.organization.id);

  return {
    deletedId: req.params.id,
  };
});
