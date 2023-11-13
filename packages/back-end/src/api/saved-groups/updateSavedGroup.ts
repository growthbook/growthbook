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
    const { name, attributeKey, condition } = req.body;
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
      condition: condition ?? savedGroup.condition ?? "",
    };

    if (attributeKey && attributeKey !== savedGroup.attributeKey) {
      if (savedGroup.source === "runtime") {
        const existing = await getRuntimeSavedGroup(
          attributeKey,
          req.organization.id
        );
        if (existing) {
          throw new Error("A runtime saved group with that key already exists");
        }
        fieldsToUpdate.attributeKey = attributeKey;
      } else {
        throw new Error(
          "Cannot update the attributeKey for an inline Saved Group"
        );
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
