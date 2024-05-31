import { auditDetailsUpdate } from "../../services/audit";
import { savedGroupUpdated } from "../../services/savedGroups";
import { PostSavedGroupAddMemberResponse } from "../../../types/openapi";
import {
  getSavedGroupById,
  updateSavedGroupById,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSavedGroupAddMemberValidator } from "../../validators/openapi";

export const postSavedGroupAddMember = createApiRequestHandler(
  postSavedGroupAddMemberValidator
)(
  async (req): Promise<PostSavedGroupAddMemberResponse> => {
    if (!req.context.permissions.canUpdateSavedGroup()) {
      req.context.permissions.throwPermissionError();
    }
    const { org } = req.context;
    const { id, mid } = req.params;

    if (!id) {
      throw new Error("Must specify saved group id");
    }

    const savedGroup = await getSavedGroupById(id, org.id);

    if (!savedGroup) {
      throw new Error("Could not find saved group");
    }

    if (!mid) {
      throw new Error("Must specify member id to add to group");
    }

    if (savedGroup.type !== "list") {
      throw new Error("Can only add members to ID list saved groups");
    }

    let newValues = savedGroup.values || [];
    if (!newValues.includes(mid)) {
      newValues = newValues.concat([mid]);
      const changes = await updateSavedGroupById(id, org.id, {
        values: newValues,
      });

      const updatedSavedGroup = { ...savedGroup, ...changes };

      await req.audit({
        event: "savedGroup.updated",
        entity: {
          object: "savedGroup",
          id: updatedSavedGroup.id,
          name: savedGroup.groupName,
        },
        details: auditDetailsUpdate(savedGroup, updatedSavedGroup),
      });

      savedGroupUpdated(req.context, savedGroup.id);
    }

    return {};
  }
);
