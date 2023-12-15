import { isEqual } from "lodash";
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

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator
)(
  async (req): Promise<UpdateSavedGroupResponse> => {
    const { name, values, attributeKey } = req.body;
    let { owner } = req.body;

    const { id } = req.params;

    const savedGroup = await getSavedGroupById(id, req.organization.id);

    if (!savedGroup) {
      throw new Error(`Unable to locate the saved-group: ${id}`);
    }

    if (!values && !name && typeof owner === "undefined") {
      throw new Error(
        'You must pass in at least one of the following: "values", "name", "owner".'
      );
    }

    if (typeof owner === "string") {
      owner = owner ? owner : "";
    } else {
      owner = savedGroup.owner;
    }

    const fieldsToUpdate: UpdateSavedGroupProps = {
      values: values ? values : savedGroup.values,
      groupName: name ? name : savedGroup.groupName,
      owner,
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

    // If the values or key change, we need to invalidate cached feature rules
    if (
      !isEqual(savedGroup.values, fieldsToUpdate.values) ||
      fieldsToUpdate.attributeKey
    ) {
      savedGroupUpdated(req.organization, savedGroup.id, req.readAccessFilter);
    }

    return {
      savedGroup: toSavedGroupApiInterface({
        ...savedGroup,
        ...updatedSavedGroup,
      }),
    };
  }
);
