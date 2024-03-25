import crypto from "crypto";
import { Response } from "express";
import { findAllOrganizations } from "@back-end/src/models/OrganizationModel";
import {
  getLicenseMetaData,
  initializeLicense,
} from "@back-end/src/services/licenseData";
import { getUserLicenseCodes } from "@back-end/src/services/users";
import { AuthRequest } from "@back-end/src/types/AuthRequest";

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
