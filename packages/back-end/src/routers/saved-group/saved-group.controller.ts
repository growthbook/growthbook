import type { Response } from "express";
import { isEqual } from "lodash";
import { validateCondition } from "shared/util";
import { AuthRequest } from "@back-end/src/types/AuthRequest";
import { getContextFromReq } from "@back-end/src/services/organizations";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "@back-end/src/services/audit";
import { savedGroupUpdated } from "@back-end/src/services/savedGroups";
import { ApiErrorResponse } from "@back-end/types/api";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
  SavedGroupInterface,
} from "@back-end/types/saved-group";
import {
  createSavedGroup,
  deleteSavedGroupById,
  getSavedGroupById,
  updateSavedGroupById,
} from "@back-end/src/models/SavedGroupModel";

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
  const { org, userName } = getContextFromReq(req);
  const { groupName, owner, attributeKey, values, type, condition } = req.body;

  req.checkPermissions("manageSavedGroups");

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

  req.checkPermissions("manageSavedGroups");

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
    savedGroupUpdated(context, savedGroup.id);
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
  req.checkPermissions("manageSavedGroups");

  const { id } = req.params;
  const { org } = getContextFromReq(req);

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
