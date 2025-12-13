import type { Response } from "express";
import { isEqual } from "lodash";
import {
  formatByteSizeString,
  SAVED_GROUP_SIZE_LIMIT_BYTES,
  ID_LIST_DATATYPES,
  validateCondition,
} from "shared/util";
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
  getAllSavedGroups,
  getSavedGroupById,
  updateSavedGroupById,
} from "back-end/src/models/SavedGroupModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { savedGroupUpdated } from "back-end/src/services/savedGroups";

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
    const allSavedGroups = await getAllSavedGroups(org.id);
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    const conditionRes = validateCondition(condition, groupMap);
    if (!conditionRes.success) {
      throw new Error(conditionRes.error);
    }
    if (conditionRes.empty) {
      throw new Error("Condition cannot be empty");
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

  const savedGroup = await createSavedGroup(org.id, {
    values: uniqValues,
    type,
    condition,
    groupName,
    owner: owner || userName,
    attributeKey,
    description,
    projects,
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
  const { groupName, owner, values, condition, description, projects } =
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
  if (
    savedGroup.type === "condition" &&
    condition &&
    condition !== savedGroup.condition
  ) {
    // Validate condition to make sure it's valid
    const allSavedGroups = await getAllSavedGroups(org.id);
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    // Include the updated condition in the savedGroupsObj for validation
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
