import { PutSavedGroupResponse } from "../../../types/openapi";
import {
  getSavedGroupById,
  parseSavedGroupString,
  toSavedGroupApiInterface,
  updateSavedGroup,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { putSavedGroupValidator } from "../../validators/openapi";

export const putSavedGroup = createApiRequestHandler(putSavedGroupValidator)(
  async (req): Promise<PutSavedGroupResponse> => {
    const { groupName, groupList, owner } = req.body;
    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    const updatedSavedGroup = await updateSavedGroup(id, req.organization.id, {
      values: groupList ? parseSavedGroupString(groupList) : savedGroup.values,
      groupName: groupName ? groupName : savedGroup?.groupName,
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
