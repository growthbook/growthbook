import { isEqual } from "lodash";
import { validateCondition, isSavedGroupCyclic } from "shared/util";
import { logger } from "back-end/src/util/logger";
import { UpdateSavedGroupResponse } from "back-end/types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
  updateSavedGroupById,
  getAllSavedGroups,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateSavedGroupValidator } from "back-end/src/validators/openapi";
import { savedGroupUpdated } from "back-end/src/services/savedGroups";
import { UpdateSavedGroupProps } from "back-end/types/saved-group";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";
import { getSavedGroupMap, getParsedCondition } from "back-end/src/services/features";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator,
)(async (req): Promise<UpdateSavedGroupResponse> => {
  const { name, values, condition, owner, projects, savedGroups } = req.body;

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
  if (savedGroup.type === "condition") {
    // Check if condition or savedGroups changed
    const conditionChanged = condition !== undefined && condition !== savedGroup.condition;
    const savedGroupsChanged = savedGroups !== undefined && !isEqual(savedGroups, savedGroup.savedGroups);
    
    if (conditionChanged || savedGroupsChanged) {
      // Get all saved groups for cycle detection
      const allSavedGroups = await getAllSavedGroups(req.organization.id);
      const groupMap = await getSavedGroupMap(req.organization, allSavedGroups);

      // Use provided values or existing values
      const finalCondition = condition !== undefined ? condition : savedGroup.condition;
      const finalSavedGroups = savedGroups !== undefined ? savedGroups : savedGroup.savedGroups;

      // Validate condition if provided
      if (finalCondition) {
        const conditionRes = validateCondition(finalCondition);
        if (!conditionRes.success) {
          throw new Error(conditionRes.error);
        }
        // Allow empty condition if savedGroups is provided
        if (conditionRes.empty && (!finalSavedGroups || finalSavedGroups.length === 0)) {
          throw new Error("Either condition or saved group targeting must be specified");
        }
      }

      // Must have either condition or savedGroups
      const hasCondition = finalCondition && finalCondition !== "{}";
      const hasSavedGroups = finalSavedGroups && finalSavedGroups.length > 0;
      if (!hasCondition && !hasSavedGroups) {
        throw new Error("Either condition or saved group targeting must be specified");
      }

      // Check for circular references (check combined condition for cycle detection)
      const combinedCondition = getParsedCondition(
        groupMap,
        finalCondition,
        finalSavedGroups,
      );
      if (combinedCondition) {
        const conditionString = JSON.stringify(combinedCondition);
        const [isCyclic, cyclicGroupId] = isSavedGroupCyclic(
          savedGroup.id,
          conditionString,
          groupMap,
          savedGroup.id, // Exclude current group from cycle check
          finalSavedGroups,
        );
        if (isCyclic) {
          throw new Error(
            `This saved group creates a circular reference${cyclicGroupId ? ` (cycle includes group: ${cyclicGroupId})` : ""}`,
          );
        }
      }

      // Store condition and savedGroups separately (don't combine on save)
      if (conditionChanged) {
        fieldsToUpdate.condition = finalCondition || undefined;
      }
      if (savedGroupsChanged) {
        fieldsToUpdate.savedGroups = finalSavedGroups;
      }
    }
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

  // If the values, condition, savedGroups, or projects change, we need to invalidate cached feature rules
  if (
    fieldsToUpdate.values ||
    fieldsToUpdate.condition ||
    fieldsToUpdate.savedGroups ||
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
