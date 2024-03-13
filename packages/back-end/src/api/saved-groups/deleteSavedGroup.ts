import { deleteSavedGroupValidator } from "@back-end/src/validators/openapi";
import { DeleteSavedGroupResponse } from "@back-end/types/openapi";
import {
  deleteSavedGroupById,
  getSavedGroupById,
} from "@back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const deleteSavedGroup = createApiRequestHandler(
  deleteSavedGroupValidator
)(
  async (req): Promise<DeleteSavedGroupResponse> => {
    const savedGroup = await getSavedGroupById(
      req.params.id,
      req.organization.id
    );

    if (!savedGroup) {
      throw new Error("Unable to delete saved group. No group found.");
    }
    req.checkPermissions("manageSavedGroups");

    await deleteSavedGroupById(req.params.id, req.organization.id);

    return {
      deletedId: req.params.id,
    };
  }
);
