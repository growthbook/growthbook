import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  findAllOrganizations,
  findOrganizationById,
} from "../models/OrganizationModel";
import { findUsersByIds } from "../models/UserModel";

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
