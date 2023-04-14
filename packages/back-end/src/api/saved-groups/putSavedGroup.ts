import { PutSavedGroupResponse } from "../../../types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroup,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { putSavedGroupValidator } from "../../validators/openapi";

export const putSavedGroup = createApiRequestHandler(putSavedGroupValidator)(
  async (req): Promise<PutSavedGroupResponse> => {
    const { name, values, owner } = req.body;
    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    const updatedSavedGroup = await updateSavedGroup(id, req.organization.id, {
      values: values ? values : savedGroup.values,
      groupName: name ? name : savedGroup?.groupName,
      owner: owner ? owner : savedGroup?.owner,
    });

    return {
      savedGroup: toSavedGroupApiInterface({
        ...savedGroup,
        ...updatedSavedGroup,
      }),
    };
  }
);
