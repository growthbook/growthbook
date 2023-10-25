import { PostSavedGroupResponse } from "../../../types/openapi";
import {
  createSavedGroup,
  getRuntimeSavedGroup,
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

    // If this is a runtime saved group, make sure the attributeKey is unique
    if (source === "runtime") {
      const existing = await getRuntimeSavedGroup(
        attributeKey,
        req.organization.id
      );
      if (existing) {
        throw new Error("A runtime saved group with that key already exists");
      }
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
