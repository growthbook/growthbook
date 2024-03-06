import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { UserInterface } from "../../types/user";
import {
  findAllOrganizations,
  findOrganizationById,
} from "../models/OrganizationModel";
import { getUserById } from "../services/users";
import { findUsersByIds, updateUserById } from "../models/UserModel";
import { getContextFromReq } from "../services/organizations";
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

  // TODO Is there an easier way to do this?
  if (Object.keys(updates).includes("superAdmin")) {
    const context = getContextFromReq(req);
    const memberIds = context.org.members.map((m) => m.id);
    if (
      !context.userId ||
      !memberIds.length ||
      !memberIds.includes(context.userId)
    ) {
      return res.status(403).json({
        status: 403,
        message:
          "Only super admins that are members of an org can update its users to super admin status",
      });
    }
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
