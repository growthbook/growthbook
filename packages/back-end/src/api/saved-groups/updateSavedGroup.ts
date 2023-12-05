import { isEqual, pick } from "lodash";
import { UpdateSavedGroupResponse } from "../../../types/openapi";
import {
  UpdateSavedGroupProps,
  getRuntimeSavedGroup,
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateSavedGroupValidator } from "../../validators/openapi";
import { savedGroupUpdated } from "../../services/savedGroups";
import { SavedGroupInterface } from "../../../types/saved-group";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator
)(
  async (req): Promise<UpdateSavedGroupResponse> => {
    const { name, attributeKey, values, condition } = req.body;
    let { owner } = req.body;

    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    if (typeof owner === "string") {
      owner = owner ? owner : "";
    } else {
      owner = savedGroup.owner;
    }

    const fieldsToUpdate: UpdateSavedGroupProps = {
      groupName: name ? name : savedGroup.groupName,
      owner,
    };

    if (savedGroup.source === "inline") {
      if (values && condition) {
        throw new Error("Cannot update both values and condition");
      }

      if (values) {
        if (!savedGroup.attributeKey) {
          throw new Error(
            "Must specify 'condition' instead of 'values' for this saved group"
          );
        }

        fieldsToUpdate.condition = JSON.stringify({
          [savedGroup.attributeKey]: { $in: values },
        });
      } else if (condition) {
        fieldsToUpdate.condition = condition;
      }

      if (attributeKey && attributeKey !== savedGroup.attributeKey) {
        throw new Error(
          "Cannot update the attributeKey for an inline Saved Group"
        );
      }
    } else if (savedGroup.source === "runtime") {
      if (condition || values) {
        throw new Error(
          "Cannot update values or condition for a runtime saved group"
        );
      }

      if (attributeKey && attributeKey !== savedGroup.attributeKey) {
        const existing = await getRuntimeSavedGroup(
          attributeKey,
          req.organization.id
        );
        if (existing) {
          throw new Error("A runtime saved group with that key already exists");
        }
        fieldsToUpdate.attributeKey = attributeKey;
      }
    }

    const updatedSavedGroup = await updateSavedGroupById(
      id,
      req.organization.id,
      fieldsToUpdate
    );

    // If anything important changes, we need to regenerate the SDK Payload
    const importantKeys: (keyof SavedGroupInterface)[] = [
      "attributeKey",
      "condition",
    ];
    const pre = pick(savedGroup, importantKeys);
    const post = pick(updatedSavedGroup, importantKeys);

    if (!isEqual(pre, post)) {
      savedGroupUpdated(req.organization, savedGroup.id);
    }

    return {
      savedGroup: toSavedGroupApiInterface({
        ...savedGroup,
        ...updatedSavedGroup,
      }),
    };
  }
);
