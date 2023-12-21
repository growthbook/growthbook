import { isEqual } from "lodash";
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
    const { name, values, condition, owner } = req.body;

    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    const fieldsToUpdate: UpdateSavedGroupProps = {};

    if (typeof name !== "undefined" && name !== savedGroup.groupName) {
      fieldsToUpdate.groupName = name;
    }
    if (typeof owner !== "undefined" && owner !== savedGroup.owner) {
      fieldsToUpdate.owner = owner;
    }
    if (
      savedGroup.type === "list" &&
      values &&
      !isEqual(values, savedGroup.values)
    ) {
      fieldsToUpdate.values = values;
    }
    if (
      savedGroup.type === "condition" &&
      condition &&
      condition !== savedGroup.condition
    ) {
      fieldsToUpdate.condition = condition;
    }

    // If there are no changes, return early
    if (Object.keys(fieldsToUpdate).length === 0) {
      return {
        savedGroup: toSavedGroupApiInterface(savedGroup),
      };
    }

    const updatedSavedGroup = await updateSavedGroupById(
      id,
      req.organization.id,
      fieldsToUpdate
    );

    // If the values or key change, we need to invalidate cached feature rules
    if (
      !isEqual(savedGroup.values, fieldsToUpdate.values) ||
      fieldsToUpdate.attributeKey
    ) {
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
