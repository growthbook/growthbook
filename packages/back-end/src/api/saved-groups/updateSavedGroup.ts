import { isLegacySavedGroup } from "shared/util";
import { UpdateSavedGroupResponse } from "../../../types/openapi";
import {
  UpdateSavedGroupProps,
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateSavedGroupValidator } from "../../validators/openapi";
import { savedGroupUpdated } from "../../services/savedGroups";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator
)(
  async (req): Promise<UpdateSavedGroupResponse> => {
    const { name, values, condition } = req.body;
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

    if (condition) {
      fieldsToUpdate.condition = condition;
    }
    // Backwards-compatible support for providing a list of values instead of a full condition
    else if (values) {
      if (
        !isLegacySavedGroup(savedGroup.condition, savedGroup.attributeKey || "")
      ) {
        throw new Error(
          "Must specify 'condition' instead of 'values' for this saved group"
        );
      }

      fieldsToUpdate.condition = JSON.stringify({
        [savedGroup.attributeKey || ""]: { $in: values },
      });
    }

    const updatedSavedGroup = await updateSavedGroupById(
      id,
      req.organization.id,
      fieldsToUpdate
    );

    // If anything important changes, we need to regenerate the SDK Payload
    if (savedGroup.condition !== updatedSavedGroup.condition) {
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
