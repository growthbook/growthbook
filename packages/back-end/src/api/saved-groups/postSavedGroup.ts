import { PostSavedGroupResponse } from "../../../types/openapi";
import {
  createSavedGroup,
  toSavedGroupApiInterface,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSavedGroupValidator } from "../../validators/openapi";

export const postSavedGroup = createApiRequestHandler(postSavedGroupValidator)(
  async (req): Promise<PostSavedGroupResponse> => {
    const { name, condition, owner } = req.body;

    if (!condition) {
      throw new Error("Condition must not be empty");
    }

    const savedGroup = await createSavedGroup({
      groupName: name,
      owner: owner || "",
      organization: req.organization.id,
      condition: condition,
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
