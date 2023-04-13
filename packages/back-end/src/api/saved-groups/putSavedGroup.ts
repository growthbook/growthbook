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
    const { groupName, groupList } = req.body;
    const { id } = req.params;
    let { owner } = req.body;

    if (!owner) {
      owner = "";
    }

    const values = parseSavedGroupString(groupList);

    await updateSavedGroup(id, req.organization.id, {
      values,
      groupName,
      owner,
    });

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    //TODO: Is this right, I don't know if I should have to add this logic.
    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
