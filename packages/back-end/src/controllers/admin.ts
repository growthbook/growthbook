import crypto from "crypto";
import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { UserInterface } from "../../types/user";
import {
  findAllOrganizations,
  findOrganizationById,
} from "../models/OrganizationModel";
import { getLicenseMetaData, initializeLicense } from "../services/licenseData";
import { getUserLicenseCodes } from "../services/users";
import { findUsersByIds, updateUserById } from "../models/UserModel";
import { getContextFromReq } from "../services/organizations";

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

/**
 * An endpoint mostly used to refresh the license data manually, if they
 * have only recently paid for a subscription or for more seats and don't
 * want to restart their servers.
 */
export async function getLicenseData(req: AuthRequest, res: Response) {
  req.checkPermissions("manageBilling");

  // Force refresh the license data
  const licenseData = await initializeLicense(
    req.organization?.licenseKey,
    true
  );

  return res.status(200).json({
    status: 200,
    licenseData,
  });
}

/**
 * An endpoint to download license usage data, for use in organizations
 * that have an old style airgap license, so that they can download the
 * data and send it to us.
 */
export async function getLicenseReport(req: AuthRequest, res: Response) {
  req.checkPermissions("manageBilling");

  const timestamp = new Date().toISOString();
  const licenseMetaData = await getLicenseMetaData();
  const userLicenseCodes = await getUserLicenseCodes();

  // Create a hmac signature of the license data
  const hmac = crypto.createHmac("sha256", licenseMetaData.installationId);

  const report = {
    timestamp,
    licenseMetaData,
    userLicenseCodes,
  };

  return res.status(200).json({
    status: 200,
    ...report,
    signature: hmac.update(JSON.stringify(report)).digest("hex"),
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

  return res.status(200).json({
    updated,
  });
}
