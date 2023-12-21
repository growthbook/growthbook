import { PostSavedGroupResponse } from "../../../types/openapi";
import {
  createSavedGroup,
  toSavedGroupApiInterface,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSavedGroupValidator } from "../../validators/openapi";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    const { name, attributeKey, values, condition, owner, type } = req.body;

    // If this is a condition group, make sure the condition is valid and not empty
    if (type === "condition") {
      if (!condition) {
        throw new Error("Must specify a condition");
      }
      // Try parsing the condition to make sure it's valid
      JSON.parse(condition);
    }
    // If this is a list group, make sure the attributeKey is specified
    else {
      if (!attributeKey) {
        throw new Error("Must specify an attributeKey");
      }
    }

    const savedGroup = await createSavedGroup({
      type: type || "list",
      values: values || [],
      groupName: name,
      owner: owner || "",
      condition: condition || "",
      attributeKey,
      organization: req.organization.id,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
