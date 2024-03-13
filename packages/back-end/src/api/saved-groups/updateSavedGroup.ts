import { isEqual } from "lodash";
import { validateCondition } from "shared/util";
import { savedGroupUpdated } from "@/src/services/savedGroups";
import { updateSavedGroupValidator } from "@/src/validators/openapi";
import { UpdateSavedGroupResponse } from "@/types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
} from "@/src/models/SavedGroupModel";
import { UpdateSavedGroupProps } from "@/types/saved-group";
import { createApiRequestHandler } from "@/src/util/handler";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator
)(
  async (req): Promise<UpdateSavedGroupResponse> => {
    req.checkPermissions("manageSavedGroups");

    const { name, values, condition, owner } = req.body;

    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    // Sanity check to make sure arguments match the saved group type
    if (savedGroup.type === "condition" && values && values.length > 0) {
      throw new Error("Cannot specify values for condition groups");
    }
    if (savedGroup.type === "list" && condition && condition !== "{}") {
      throw new Error("Cannot specify a condition for list groups");
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
      const conditionRes = validateCondition(condition);
      if (!conditionRes.success) {
        throw new Error(conditionRes.error);
      }
      if (conditionRes.empty) {
        throw new Error("Condition cannot be empty");
      }

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
    if (fieldsToUpdate.values || fieldsToUpdate.condition) {
      savedGroupUpdated(req.context, savedGroup.id);
    }

    return {
      savedGroup: toSavedGroupApiInterface({
        ...savedGroup,
        ...updatedSavedGroup,
      }),
    };
  }
);
