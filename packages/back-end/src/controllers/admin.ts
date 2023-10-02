import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { findAllOrganizations } from "../models/OrganizationModel";

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
