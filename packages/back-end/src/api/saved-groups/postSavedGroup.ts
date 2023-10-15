import { PostSavedGroupResponse } from "../../../types/openapi";
import {
  createSavedGroup,
  toSavedGroupApiInterface,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSavedGroupValidator } from "../../validators/openapi";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    const { name, attributeKey, values, source } = req.body;
    let { owner } = req.body;

    if (!owner) {
      owner = "";
    }
    const savedGroup = await createSavedGroup({
      source: source || "inline",
      values: values || [],
      groupName: name,
      owner,
      attributeKey,
      organization: req.organization.id,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
