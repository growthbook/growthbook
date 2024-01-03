import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { findAllOrganizations } from "../models/OrganizationModel";
import { initializeLicense } from "../services/licenseData";

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
  // While viewing license data is generally showed to admins, it is not
  // particularly sensitive data that we need to restrict to admins only.

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
