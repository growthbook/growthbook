import { UpdateSavedGroupResponse } from "../../../types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateSavedGroupValidator } from "../../validators/openapi";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator
)(
  async (req): Promise<UpdateSavedGroupResponse> => {
    const { name, values } = req.body;
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

    const updatedSavedGroup = await updateSavedGroupById(
      id,
      req.organization.id,
      {
        values: values ? values : savedGroup.values,
        groupName: name ? name : savedGroup.groupName,
        owner,
      }
    );

    return {
      savedGroup: toSavedGroupApiInterface({
        ...savedGroup,
        ...updatedSavedGroup,
      }),
    };
  }
);
