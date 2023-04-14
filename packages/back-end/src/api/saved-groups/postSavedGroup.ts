import { PostSavedGroupResponse } from "../../../types/openapi";
import {
  createSavedGroup,
  parseSavedGroupString,
  toSavedGroupApiInterface,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSavedGroupValidator } from "../../validators/openapi";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    const { groupName, attributeKey, groupList } = req.body;
    let { owner } = req.body;
    const values = parseSavedGroupString(groupList);

    if (!owner) {
      owner = "";
    }
    const savedGroup = await createSavedGroup({
      values,
      groupName,
      owner,
      attributeKey,
      organization: req.organization.id,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
