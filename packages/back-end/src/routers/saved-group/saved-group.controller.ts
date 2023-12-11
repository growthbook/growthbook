import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { SavedGroupInterface } from "../../../types/saved-group";
import {
  UpdateSavedGroupProps,
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

type CreateSavedGroupRequest = AuthRequest<{
  groupName: string;
  owner: string;
  condition: string;
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
  const { groupName, owner, condition } = req.body;

  req.checkPermissions("manageSavedGroups");

  const savedGroup = await createSavedGroup({
    groupName,
    owner: owner || userName,
    organization: org.id,
    condition,
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

type PutSavedGroupRequest = AuthRequest<
  {
    groupName: string;
    owner: string;
    condition: string;
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
  const { groupName, owner, condition } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  req.checkPermissions("manageSavedGroups");

  const savedGroup = await getSavedGroupById(id, org);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  const fieldsToUpdate: UpdateSavedGroupProps = {
    groupName,
    owner,
    condition,
  };

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

  // If condition changes, we need to regenerate the SDK Payload
  if (savedGroup.condition !== updatedSavedGroup.condition) {
    savedGroupUpdated(org, savedGroup.id);
  }

  return res.status(200).json({
    status: 200,
  });
};

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

  const savedGroup = await getSavedGroupById(id, org);

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
