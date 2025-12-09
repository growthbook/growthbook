import type { Response } from "express";
import { isEqual } from "lodash";
import {
  formatByteSizeString,
  SAVED_GROUP_SIZE_LIMIT_BYTES,
  ID_LIST_DATATYPES,
  validateCondition,
  isSavedGroupCyclic,
} from "shared/util";
import { getParsedCondition } from "back-end/src/util/features";
import { SavedGroupInterface } from "shared/types/groups";
import { logger } from "back-end/src/util/logger";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import {
  createSavedGroup,
  deleteSavedGroupById,
  getSavedGroupById,
  updateSavedGroupById,
  getAllSavedGroups,
} from "back-end/src/models/SavedGroupModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { savedGroupUpdated } from "back-end/src/services/savedGroups";
import { getSavedGroupMap } from "back-end/src/services/features";

// region POST /saved-groups

type CreateSavedGroupRequest = AuthRequest<CreateSavedGroupProps>;

type CreateSavedGroupResponse = {
  status: 200;
  savedGroup: SavedGroupInterface;
};

/**
 * POST /saved-groups
 * Create a saved-group resource
 * @param req
 * @param res
 */
export const postSavedGroup = async (
  req: CreateSavedGroupRequest,
  res: Response<CreateSavedGroupResponse>,
) => {
  const context = getContextFromReq(req);
  const { org, userName } = context;
  const {
    groupName,
    owner,
    attributeKey,
    values,
    type,
    condition,
    description,
    projects,
    savedGroups,
  } = req.body;

  if (!context.permissions.canCreateSavedGroup({ ...req.body })) {
    context.permissions.throwPermissionError();
  }

  if (projects) {
    await context.models.projects.ensureProjectsExist(projects);
  }

  let uniqValues: string[] | undefined = undefined;
  // If this is a condition group, make sure the condition is valid and not empty
  if (type === "condition") {
    // Get all saved groups for cycle detection
    const allSavedGroups = await getAllSavedGroups(org.id);
    const groupMap = await getSavedGroupMap(org, allSavedGroups);

    // Validate condition if provided
    if (condition) {
      const conditionRes = validateCondition(condition);
      if (!conditionRes.success) {
        throw new Error(conditionRes.error);
      }
      // Allow empty condition if savedGroups is provided
      if (conditionRes.empty && (!savedGroups || savedGroups.length === 0)) {
        throw new Error("Either condition or saved group targeting must be specified");
      }
    }

    // Must have either condition or savedGroups
    const hasCondition = condition && condition !== "{}";
    const hasSavedGroups = savedGroups && savedGroups.length > 0;
    if (!hasCondition && !hasSavedGroups) {
      throw new Error("Either condition or saved group targeting must be specified");
    }

    // Check for circular references (check both condition and savedGroups)
    // We need to check the combined condition for cycle detection
    const combinedCondition = getParsedCondition(
      groupMap,
      condition,
      savedGroups,
    );
    if (combinedCondition) {
      const conditionString = JSON.stringify(combinedCondition);
      const [isCyclic, cyclicGroupId] = isSavedGroupCyclic(
        undefined, // New group, ID not assigned yet
        conditionString,
        groupMap,
        undefined,
        savedGroups,
      );
      if (isCyclic) {
        throw new Error(
          `This saved group creates a circular reference${cyclicGroupId ? ` (cycle includes group: ${cyclicGroupId})` : ""}`,
        );
      }
    }
  } else if (type === "list") {
    // If this is a list group, make sure the attributeKey is specified
    if (!attributeKey) {
      throw new Error("Must specify an attributeKey");
    }
    const attributeSchema = org.settings?.attributeSchema || [];
    const datatype = attributeSchema.find(
      (sdkAttr) => sdkAttr.property === attributeKey,
    )?.datatype;
    if (!datatype) {
      throw new Error("Unknown attributeKey");
    }
    if (!ID_LIST_DATATYPES.includes(datatype)) {
      throw new Error(
        "Cannot create an ID List for the given attribute key. Try using a Condition Group instead.",
      );
    }
    uniqValues = [...new Set(values)];
    // Check that the size is within the global limit as well as any limit imposed by the organization
    validateListSize(
      uniqValues,
      org.settings?.savedGroupSizeLimit,
      context.permissions.canBypassSavedGroupSizeLimit(projects),
    );
  }
  if (typeof description === "string" && description.length > 100) {
    throw new Error("Description must be at most 100 characters");
  }

  // Store condition and savedGroups separately (don't combine on save)
  const savedGroup = await createSavedGroup(org.id, {
    values: uniqValues,
    type,
    condition: condition || undefined,
    groupName,
    owner: owner || userName,
    attributeKey,
    description,
    projects,
    savedGroups: type === "condition" ? savedGroups : undefined,
  });

  await req.audit({
    event: "savedGroup.created",
    entity: {
      object: "savedGroup",
      id: savedGroup.id,
      name: groupName,
    },
    details: auditDetailsCreate(savedGroup),
  });

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
};

// endregion POST /saved-groups

// region GET /saved-groups/:id

type GetSavedGroupRequest = AuthRequest<Record<string, never>, { id: string }>;

type GetSavedGroupResponse = {
  status: 200;
  savedGroup: SavedGroupInterface;
};

/**
 * GET /saved-groups/:id
 * Fetch a saved-group resource
 * @param req
 * @param res
 */
export const getSavedGroup = async (
  req: GetSavedGroupRequest,
  res: Response<GetSavedGroupResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
};

// endregion GET /saved-groups/:id

// region POST /saved-groups/:id/add-items

type PostSavedGroupAddItemsRequest = AuthRequest<
  { items: string[] },
  { id: string }
>;

type PostSavedGroupAddItemsResponse = {
  status: 200;
};

/**
 * POST /saved-groups/:id/add-items
 * Update one saved-group resource by adding the specified list of items
 * @param req
 * @param res
 */
export const postSavedGroupAddItems = async (
  req: PostSavedGroupAddItemsRequest,
  res: Response<PostSavedGroupAddItemsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { items } = req.body;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  if (savedGroup.type !== "list") {
    throw new Error("Can only add items to ID list saved groups");
  }

  if (!items) {
    throw new Error("Must specify items to add to group");
  }

  if (!Array.isArray(items)) {
    throw new Error("Must provide a list of items to add");
  }

  const attributeSchema = org.settings?.attributeSchema || [];
  const datatype = attributeSchema.find(
    (sdkAttr) => sdkAttr.property === savedGroup.attributeKey,
  )?.datatype;
  if (!datatype) {
    throw new Error("Unknown attributeKey");
  }
  if (!ID_LIST_DATATYPES.includes(datatype)) {
    throw new Error(
      "Cannot add items to this group. The attribute key's datatype is not supported.",
    );
  }
  const newValues = [...new Set([...(savedGroup.values || []), ...items])];
  // Check that the size is within the global limit as well as any limit imposed by the organization
  validateListSize(
    newValues,
    org.settings?.savedGroupSizeLimit,
    context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
  );

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

  savedGroupUpdated(context, savedGroup.id);

  return res.status(200).json({
    status: 200,
  });
};

// endregion POST /saved-groups/:id/add-items

// region POST /saved-groups/:id/remove-items

type PostSavedGroupRemoveItemsRequest = AuthRequest<
  { items: string[] },
  { id: string }
>;

type PostSavedGroupRemoveItemsResponse = {
  status: 200;
};

/**
 * POST /saved-groups/:id/remove-items
 * Update one saved-group resource by removing the specified list of items
 * @param req
 * @param res
 */
export const postSavedGroupRemoveItems = async (
  req: PostSavedGroupRemoveItemsRequest,
  res: Response<PostSavedGroupRemoveItemsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { items } = req.body;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  if (savedGroup.type !== "list") {
    throw new Error("Can only remove items from ID list saved groups");
  }

  if (!items) {
    throw new Error("Must specify items to remove from group");
  }

  if (!Array.isArray(items)) {
    throw new Error("Must provide a list of items to remove");
  }

  const attributeSchema = org.settings?.attributeSchema || [];
  const datatype = attributeSchema.find(
    (sdkAttr) => sdkAttr.property === savedGroup.attributeKey,
  )?.datatype;
  if (!datatype) {
    throw new Error("Unknown attributeKey");
  }
  if (!ID_LIST_DATATYPES.includes(datatype)) {
    throw new Error(
      "Cannot remove items from this group. The attribute key's datatype is not supported.",
    );
  }
  const toRemove = new Set(items);
  const newValues = (savedGroup.values || []).filter(
    (value) => !toRemove.has(value),
  );
  // Check that the size is within the global limit as well as any limit imposed by the organization
  validateListSize(
    newValues,
    org.settings?.savedGroupSizeLimit,
    context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
  );
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

  savedGroupUpdated(context, savedGroup.id);

  return res.status(200).json({
    status: 200,
  });
};

// endregion POST /saved-groups/:id/remove-items

// region PUT /saved-groups/:id

type PutSavedGroupRequest = AuthRequest<UpdateSavedGroupProps, { id: string }>;

type PutSavedGroupResponse = {
  status: 200;
};

/**
 * PUT /saved-groups/:id
 * Update one saved-group resource
 * @param req
 * @param res
 */
export const putSavedGroup = async (
  req: PutSavedGroupRequest,
  res: Response<PutSavedGroupResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { groupName, owner, values, condition, description, projects, savedGroups } =
    req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, { ...req.body })) {
    context.permissions.throwPermissionError();
  }

  const fieldsToUpdate: UpdateSavedGroupProps = {};

  if (typeof groupName !== "undefined" && groupName !== savedGroup.groupName) {
    fieldsToUpdate.groupName = groupName;
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
    // Check that the size is within the global limit as well as any limit imposed by the organization
    validateListSize(
      values,
      org.settings?.savedGroupSizeLimit,
      context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
    );
  }
  if (savedGroup.type === "condition") {
    // Check if condition or savedGroups changed
    const conditionChanged = condition !== undefined && condition !== savedGroup.condition;
    const savedGroupsChanged = savedGroups !== undefined && !isEqual(savedGroups, savedGroup.savedGroups);
    
    if (conditionChanged || savedGroupsChanged) {
      // Get all saved groups for cycle detection
      const allSavedGroups = await getAllSavedGroups(org.id);
      const groupMap = await getSavedGroupMap(org, allSavedGroups);

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
  if (description !== savedGroup.description) {
    if (typeof description === "string" && description.length > 100) {
      throw new Error("Description must be at most 100 characters");
    }
    fieldsToUpdate.description = description;
  }
  if (!isEqual(savedGroup.projects, projects)) {
    if (projects) {
      await context.models.projects.ensureProjectsExist(projects);
    }
    fieldsToUpdate.projects = projects;
  }

  // If there are no changes, return early
  if (Object.keys(fieldsToUpdate).length === 0) {
    return res.status(200).json({
      status: 200,
    });
  }

  const changes = await updateSavedGroupById(id, org.id, fieldsToUpdate);

  const updatedSavedGroup = { ...savedGroup, ...changes };

  await req.audit({
    event: "savedGroup.updated",
    entity: {
      object: "savedGroup",
      id: updatedSavedGroup.id,
      name: groupName,
    },
    details: auditDetailsUpdate(savedGroup, updatedSavedGroup),
  });

  // If the values, condition, or projects change, we need to invalidate cached feature rules
  if (
    fieldsToUpdate.condition ||
    fieldsToUpdate.values ||
    fieldsToUpdate.projects
  ) {
    savedGroupUpdated(context, savedGroup.id).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on saved group update");
    });
  }

  return res.status(200).json({
    status: 200,
  });
};

// endregion PUT /saved-groups/:id

// region DELETE /saved-groups/:id

type DeleteSavedGroupRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteSavedGroupResponse =
  | {
      status: 200;
    }
  | {
      status: number;
      message: string;
    };

/**
 * DELETE /saved-groups/:id
 * Delete one saved-group resource by ID
 * @param req
 * @param res
 */
export const deleteSavedGroup = async (
  req: DeleteSavedGroupRequest,
  res: Response<DeleteSavedGroupResponse>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const { org } = context;

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    res.status(403).json({
      status: 404,
      message: "Saved group not found",
    });
    return;
  }

  if (savedGroup.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this saved group",
    });
    return;
  }

  if (!context.permissions.canDeleteSavedGroup(savedGroup)) {
    context.permissions.throwPermissionError();
  }

  await deleteSavedGroupById(id, org.id);

  await req.audit({
    event: "savedGroup.deleted",
    entity: {
      object: "savedGroup",
      id: id,
      name: savedGroup.groupName,
    },
    details: auditDetailsDelete(savedGroup),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /saved-groups/:id

export function validateListSize(
  values: Array<unknown>,
  savedGroupSizeLimit: number | undefined,
  canBypassSizeLimit: boolean,
) {
  if (
    savedGroupSizeLimit &&
    values.length > savedGroupSizeLimit &&
    !canBypassSizeLimit
  ) {
    throw new Error(
      `Your organization has imposed a maximum list length of ${savedGroupSizeLimit}`,
    );
  }
  if (new Blob([JSON.stringify(values)]).size > SAVED_GROUP_SIZE_LIMIT_BYTES) {
    throw new Error(
      `The maximum size for a list is ${formatByteSizeString(
        SAVED_GROUP_SIZE_LIMIT_BYTES,
      )}.`,
    );
  }
}
