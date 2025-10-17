import { isEqual } from "lodash";
import { validateCondition } from "shared/util";
import { logger } from "back-end/src/util/logger";
import { UpdateSavedGroupResponse } from "back-end/types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateSavedGroupValidator } from "back-end/src/validators/openapi";
import { savedGroupUpdated } from "back-end/src/services/savedGroups";
import { UpdateSavedGroupProps } from "back-end/types/saved-group";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator,
)(async (req): Promise<UpdateSavedGroupResponse> => {
  const { name, values, condition, owner, projects } = req.body;

  const { id } = req.params;

  const savedGroup = await getSavedGroupById(id, req.organization.id);

  if (!savedGroup) {
    throw new Error(`Unable to locate the saved-group: ${id}`);
  }

  if (
    !req.context.permissions.canUpdateSavedGroup(savedGroup, { ...req.body })
  ) {
    req.context.permissions.throwPermissionError();
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
    validateListSize(
      values,
      req.context.org.settings?.savedGroupSizeLimit,
      req.context.permissions.canBypassSavedGroupSizeLimit(projects),
    );
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
  if (!isEqual(savedGroup.projects, projects)) {
    if (projects) {
      await req.context.models.projects.ensureProjectsExist(projects);
    }
    fieldsToUpdate.projects = projects;
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
    fieldsToUpdate,
  );

  // If the values, condition, or projects change, we need to invalidate cached feature rules
  if (
    fieldsToUpdate.values ||
    fieldsToUpdate.condition ||
    fieldsToUpdate.projects
  ) {
    savedGroupUpdated(req.context, savedGroup.id).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on saved group update");
    });
  }

  return {
    savedGroup: toSavedGroupApiInterface({
      ...savedGroup,
      ...updatedSavedGroup,
    }),
  };
});
