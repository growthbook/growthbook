import { Response } from "express";
import { OrganizationInterface } from "@back-end/types/organization";
import { AuthRequest } from "../types/AuthRequest";
import { UserInterface } from "../../types/user";
import {
  findAllOrganizations,
  findOrganizationById,
  updateOrganization,
} from "../models/OrganizationModel";
import {
  findUserById,
  findUsersByIds,
  updateUserById,
} from "../models/UserModel";
import { getOrganizationById } from "../services/organizations";
import { setLicenseKey } from "../routers/organizations/organizations.controller";
import { auditDetailsUpdate } from "../services/audit";

export async function getOrganizations(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all organizations",
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

export async function putOrganization(
  req: AuthRequest<{
    orgId: string;
    name: string;
    externalId: string;
    licenseKey: string;
  }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can update organizations via admin page",
    });
  }

  const { orgId, name, externalId, licenseKey } = req.body;
  const updates: Partial<OrganizationInterface> = {};
  const orig: Partial<OrganizationInterface> = {};
  const org = await getOrganizationById(orgId);

  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  if (name) {
    updates.name = name;
    orig.name = org.name;
  }
  if (externalId !== undefined) {
    updates.externalId = externalId;
    orig.externalId = org.externalId;
  }
  if (licenseKey && licenseKey.trim() !== org.licenseKey) {
    updates.licenseKey = licenseKey.trim();
    orig.licenseKey = org.licenseKey;
    await setLicenseKey(org, updates.licenseKey);
  }

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(orig, updates),
  });

  return res.status(200).json({
    status: 200,
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

  const user = await findUserById(userId);

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
