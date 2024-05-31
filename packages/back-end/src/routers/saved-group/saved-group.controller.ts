import type { Response } from "express";
import { isEqual } from "lodash";
import { validateCondition } from "shared/util";
import { logger } from "../../util/logger";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
  SavedGroupInterface,
} from "../../../types/saved-group";
import {
  createSavedGroup,
  deleteSavedGroupById,
  getSavedGroupById,
  updateSavedGroupById,
} from "../../models/SavedGroupModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import { savedGroupUpdated } from "../../services/savedGroups";

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
  res: Response<CreateSavedGroupResponse>
) => {
  const context = getContextFromReq(req);
  const { org, userName } = context;
  const { groupName, owner, attributeKey, values, type, condition } = req.body;

  if (!context.permissions.canCreateSavedGroup()) {
    context.permissions.throwPermissionError();
  }

  // If this is a condition group, make sure the condition is valid and not empty
  if (type === "condition") {
    const conditionRes = validateCondition(condition);
    if (!conditionRes.success) {
      throw new Error(conditionRes.error);
    }
    if (conditionRes.empty) {
      throw new Error("Condition cannot be empty");
    }
  }
  // If this is a list group, make sure the attributeKey is specified
  else if (type === "list") {
    if (!attributeKey) {
      throw new Error("Must specify an attributeKey");
    }
  }

  const savedGroup = await createSavedGroup(org.id, {
    values,
    type,
    condition,
    groupName,
    owner: owner || userName,
    attributeKey,
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
  res: Response<GetSavedGroupResponse>
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  // TODO: do we need a permissions check
  // if (false) {
  //   context.permissions.throwPermissionError();
  // }

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

// region POST /saved-groups/:id/add-member/:mid

type PostSavedGroupAddMemberRequest = AuthRequest<
  Record<string, never>,
  { id: string; mid: string }
>;

type PostSavedGroupAddMemberResponse = {
  status: 200;
};

/**
 * POST /saved-groups/:id/add-member/:mid
 * Update one saved-group resource by adding the specified member
 * @param req
 * @param res
 */
export const postSavedGroupAddMember = async (
  req: PostSavedGroupAddMemberRequest,
  res: Response<PostSavedGroupAddMemberResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, mid } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  if (!context.permissions.canUpdateSavedGroup()) {
    context.permissions.throwPermissionError();
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

    savedGroupUpdated(context, savedGroup.id);
  }

  return res.status(200).json({
    status: 200,
  });
};

// endregion POST /saved-groups/:id/add-member/:mid

// region POST /saved-groups/:id/remove-member/:mid

type PostSavedGroupRemoveMemberRequest = AuthRequest<
  Record<string, never>,
  { id: string; mid: string }
>;

type PostSavedGroupRemoveMemberResponse = {
  status: 200;
};

/**
 * POST /saved-groups/:id/remove-member/:mid
 * Update one saved-group resource by removing the specified member
 * @param req
 * @param res
 */
export const postSavedGroupRemoveMember = async (
  req: PostSavedGroupRemoveMemberRequest,
  res: Response<PostSavedGroupRemoveMemberResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, mid } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  if (!context.permissions.canUpdateSavedGroup()) {
    context.permissions.throwPermissionError();
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!mid) {
    throw new Error("Must specify member id to remove from group");
  }

  if (savedGroup.type !== "list") {
    throw new Error("Can only remove members from ID list saved groups");
  }

  const newValues = savedGroup.values || [];
  const index = newValues.indexOf(mid);
  if (index !== -1) {
    newValues.splice(index, 1);
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
  }

  return res.status(200).json({
    status: 200,
  });
};

// endregion POST /saved-groups/:id/remove-member/:mid

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
  res: Response<PutSavedGroupResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { groupName, owner, values, condition } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  if (!context.permissions.canUpdateSavedGroup()) {
    context.permissions.throwPermissionError();
  }

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
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
  }
  if (
    savedGroup.type === "condition" &&
    condition &&
    condition !== savedGroup.condition
  ) {
    // Validate condition to make sure it's valid
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

  // If the values or condition change, we need to invalidate cached feature rules
  if (fieldsToUpdate.condition || fieldsToUpdate.values) {
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
  res: Response<DeleteSavedGroupResponse>
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateSavedGroup()) {
    context.permissions.throwPermissionError();
  }

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
