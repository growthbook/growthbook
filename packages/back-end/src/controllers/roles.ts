import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Permissions } from "../../types/permissions";
import { updateOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";

export async function postRole(
  req: AuthRequest<
    { permissions: Permissions; description: string },
    { roleId: string }
  >,
  res: Response
): Promise<void> {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  const { roleId } = req.params;
  const { permissions, description } = req.body;

  if (org.roles[roleId]) throw new Error("Role already exists");
  if (!roleId) throw new Error("Role ID is required");

  await updateOrganization(org.id, {
    roles: { ...org.roles, [roleId]: { permissions, description } },
  });

  res.status(200).json({ status: 200 });
}

export async function updateRole(
  req: AuthRequest<{
    permissions: Permissions;
    description: string;
    newRoleId: string;
  }>,
  res: Response
): Promise<void> {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  const { roleId } = req.params;
  const { permissions, description, newRoleId } = req.body;

  if (!org.roles[roleId]) throw new Error("Role does not exist");
  if (!newRoleId) throw new Error("Role name is required");
  if (newRoleId !== roleId && org.roles[newRoleId])
    throw new Error("Role already exists");

  const newRoles = { ...org.roles };
  if (newRoleId !== roleId) {
    newRoles[newRoleId] = newRoles[roleId];
    delete newRoles[roleId];
  }

  await updateOrganization(org.id, {
    roles: { ...newRoles, [newRoleId]: { permissions, description } },
  });

  res.status(200).json({ status: 200 });
}

export async function deleteRole(
  req: AuthRequest<null, { roleId: string }>,
  res: Response
): Promise<void> {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { roleId: deletionRoleId } = req.params;

  const membersWithRole = org.members.find((m) => m.role === deletionRoleId);
  if (membersWithRole) throw new Error("Cannot delete role with members");
  if (deletionRoleId === "admin") throw new Error("Cannot delete admin role");

  const updatedRoles = { ...org.roles };
  for (const [roleId, role] of Object.entries(org.roles)) {
    if (roleId !== deletionRoleId) updatedRoles[roleId] = role;
  }

  await updateOrganization(org.id, { roles: { ...updatedRoles } });

  res.status(200).json({ status: 200 });
}
