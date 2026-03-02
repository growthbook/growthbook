import { isEqual } from "lodash";
import { validateCondition } from "shared/util";
import { UpdateSavedGroupResponse } from "shared/types/openapi";
import { updateSavedGroupValidator } from "shared/validators";
import { UpdateSavedGroupProps } from "shared/types/saved-group";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validateListSize } from "back-end/src/routers/saved-group/saved-group.controller";

export const updateSavedGroup = createApiRequestHandler(
  updateSavedGroupValidator,
)(async (req): Promise<UpdateSavedGroupResponse> => {
  const { name, values, condition, owner, projects } = req.body;

  const { id } = req.params;

  const savedGroup = await req.context.models.savedGroups.getById(id);

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
    const allSavedGroups = await req.context.models.savedGroups.getAll();
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    // Include the updated condition in the groupMap for validation
    groupMap.set(savedGroup.id, {
      ...savedGroup,
      condition,
    });

    const conditionRes = validateCondition(condition, groupMap);
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
      savedGroup: req.context.models.savedGroups.toApiInterface(savedGroup),
    };
  }

  const updatedSavedGroup = await req.context.models.savedGroups.update(
    savedGroup,
    fieldsToUpdate,
  );

  return {
    savedGroup: req.context.models.savedGroups.toApiInterface({
      ...savedGroup,
      ...updatedSavedGroup,
    }),
  };
});
