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
    let { owner, condition } = req.body;

    if (!owner) {
      owner = "";
    }

    // If this is a runtime saved group, make sure the attributeKey is unique
    if (source === "runtime") {
      if (!attributeKey) {
        throw new Error("Must specify 'attributeKey' for runtime groups");
      }
      if (condition || values?.length) {
        throw new Error(
          "Cannot specify values or condition for a runtime group"
        );
      }

      const existing = await getRuntimeSavedGroup(
        attributeKey,
        req.organization.id
      );
      if (existing) {
        throw new Error("A runtime saved group with that key already exists");
      }
    } else {
      if (!condition && attributeKey && values) {
        condition = JSON.stringify({
          [attributeKey]: { $in: values },
        });
      }

      if (!condition) {
        throw new Error(
          "Inline groups must specify either attributeKey/values OR a condition"
        );
      }
    }

    const savedGroup = await createSavedGroup({
      source: source || "inline",
      groupName: name,
      owner,
      attributeKey: attributeKey || "",
      organization: req.organization.id,
      condition: condition || "",
    });

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
