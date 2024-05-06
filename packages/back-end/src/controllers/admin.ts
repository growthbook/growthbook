import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { UserInterface } from "../../types/user";
import {
  findAllOrganizations,
  findOrganizationById,
  deleteOrganizationData,
} from "../models/OrganizationModel";
import { getUserById } from "../services/users";
import { findUsersByIds, updateUserById } from "../models/UserModel";
import { auditDetailsUpdate } from "../services/audit";

export async function getOrganizations(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only admins can get all organizations",
    });
  }

  const { page, search } = req.query;

  const { organizations, total } = await findAllOrganizations(
    parseInt(page || "") || 1,
    search || ""
  );

  return res.status(200).json({
    status: 200,
    organizations,
    total,
  });
}
export async function getUsersForOrg(
  req: AuthRequest<unknown, { orgId: string }>,
  res: Response
) {
  if (!req.superAdmin)
    return res.status(403).json({
      status: 403,
      message: "Only super admins can access this endpoint",
    });

  const { orgId } = req.params;

  const org = await findOrganizationById(orgId);

  if (!org)
    return res.status(400).json({
      status: 400,
      message: "org not found",
    });

  const userIds = org.members.map((m) => m.id);
  const users = await findUsersByIds(userIds);
  return res.status(200).json({
    users,
  });
}

export async function updateUser(
  req: AuthRequest<Partial<UserInterface>, { userId: string }>,
  res: Response
) {
  if (!req.superAdmin)
    return res.status(403).json({
      status: 403,
      message: "Only super admins can access this endpoint",
    });

  const { userId } = req.params;
  const updates = req.body;

  const user = await getUserById(userId);

  if (!user) {
    return res.status(400).json({
      status: 400,
      message: "User not found",
    });
  }

  const updated = await updateUserById(userId, updates);

  req.audit({
    event: "admin.user.update",
    entity: {
      object: "user",
      id: userId,
    },
    details: auditDetailsUpdate(user, updated),
  });

  return res.status(200).json({
    updated,
  });
}

export async function deleteOrganization(
  req: AuthRequest<null, { orgId: string }>,
  res: Response
) {
  if (!req.superAdmin)
    return res.status(403).json({
      status: 403,
      message: "Only super admins can access this endpoint",
    });

  await deleteOrganizationData(req.params.orgId);

  req.audit({
    event: "organization.delete",
    entity: {
      object: "organization",
      id: req.params.orgId,
    },
  });

  return res.status(200).json({
    status: 200,
    message: "Organization and all related data deleted",
    orgId: req.params.orgId,
  });
}
