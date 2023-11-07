import type { Response } from "express";
import { isEqual } from "lodash";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import {
  SavedGroupInterface,
  SavedGroupSource,
} from "../../../types/saved-group";
import {
  UpdateSavedGroupProps,
  createSavedGroup,
  deleteSavedGroupById,
  getRuntimeSavedGroup,
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

type CreateSavedGroupRequest = AuthRequest<{
  groupName: string;
  owner: string;
  attributeKey: string;
  groupList: string[];
  source: SavedGroupSource;
}>;

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
  const { org, userName } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList, source } = req.body;

  req.checkPermissions("manageSavedGroups");

  // If this is a runtime saved group, make sure the attributeKey is unique
  if (source === "runtime") {
    const existing = await getRuntimeSavedGroup(attributeKey, org.id);
    if (existing) {
      throw new Error("A runtime saved group with that key already exists");
    }
  }

  const savedGroup = await createSavedGroup({
    values: groupList,
    source: source || "inline",
    groupName,
    owner: owner || userName,
    attributeKey,
    organization: org.id,
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

type PutSavedGroupRequest = AuthRequest<
  {
    groupName: string;
    owner: string;
    attributeKey: string;
    groupList: string[];
  },
  { id: string }
>;

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
  const { org } = getOrgFromReq(req);
  const { groupName, owner, groupList, attributeKey } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  req.checkPermissions("manageSavedGroups");

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  const fieldsToUpdate: UpdateSavedGroupProps = {
    values: groupList,
    groupName,
    owner,
  };

  if (
    savedGroup.source === "runtime" &&
    attributeKey !== savedGroup.attributeKey
  ) {
    const existing = await getRuntimeSavedGroup(attributeKey, org.id);
    if (existing) {
      throw new Error("A runtime saved group with that key already exists");
    }

    fieldsToUpdate.attributeKey = attributeKey;
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

  // If the values or key change, we need to invalidate cached feature rules
  if (!isEqual(savedGroup.values, groupList) || fieldsToUpdate.attributeKey) {
    savedGroupUpdated(org, savedGroup.id);
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
  const { org } = getOrgFromReq(req);

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
