import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Permission, Permissions } from "../../types/permissions";
import { updateOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";

export async function postRole(
  req: AuthRequest<{ permissions: Record<Permission, boolean> }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  const { roleId } = req.params;
  const { permissions } = req.body;

  if (org.roles[roleId]) throw new Error("Role already exists");

  await updateOrganization(org.id, {
    roles: { ...org.roles, [roleId]: permissions },
  });

  res.status(200).json({ status: 200 });
}

export async function updateRole(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  const { roleId } = req.params;
  const { permissions } = req.body;

  await updateOrganization(org.id, {
    roles: { ...org.roles, [roleId]: permissions },
  });

  res.status(200).json({ status: 200 });
}

export async function deleteRole(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { roleId } = req.params;

  const membersWithRole = org.members.find((m) => m.role === roleId);
  if (membersWithRole) throw new Error("Cannot delete role with members");

  const newRoles: Record<string, Permissions> = {};
  for (const [rId, rPermissions] of Object.entries(org.roles)) {
    if (rId !== roleId) newRoles[rId] = rPermissions;
  }

  await updateOrganization(org.id, { roles: { ...newRoles } });

  res.status(200).json({ status: 200 });
}
