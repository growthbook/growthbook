import { Response } from "express";
import { OrganizationInterface } from "@back-end/types/organization";
import { UserInterface } from "@back-end/types/user";
import { getAllSSOConnections } from "../models/SSOConnectionModel";
import {
  getAllUsersFiltered,
  getTotalNumUsers,
  getUserById,
  updateUser,
} from "../models/UserModel";
import { AuthRequest } from "../types/AuthRequest";
import {
  findAllOrganizations,
  findOrganizationsByMemberId,
  updateOrganization,
} from "../models/OrganizationModel";
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

  const rawSSOs = await getAllSSOConnections();
  // we don't want to expose sensitive information, so strip out the clientSecret and some other fields
  const ssoConnections = rawSSOs.map((sso) => {
    return {
      id: sso.id,
      emailDomains: sso.emailDomains,
      organization: sso.organization,
    };
  });

  return res.status(200).json({
    status: 200,
    organizations,
    ssoConnections,
    total,
  });
}

export async function putOrganization(
  req: AuthRequest<{
    orgId: string;
    name: string;
    externalId: string;
    licenseKey: string;
    ownerEmail?: string;
    verifiedDomain?: string;
    autoApproveMembers?: boolean;
  }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can update organizations via admin page",
    });
  }

  const {
    orgId,
    name,
    externalId,
    licenseKey,
    ownerEmail,
    verifiedDomain,
    autoApproveMembers,
  } = req.body;
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
  if (ownerEmail) {
    updates.ownerEmail = ownerEmail;
    orig.ownerEmail = org.ownerEmail;
  }
  if (verifiedDomain) {
    updates.verifiedDomain = verifiedDomain;
    orig.verifiedDomain = org.verifiedDomain;
  }
  if (autoApproveMembers !== org.autoApproveMembers) {
    updates.autoApproveMembers = autoApproveMembers;
    orig.autoApproveMembers = org.autoApproveMembers;
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

export async function getMembers(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all members",
    });
  }

  const { page, search } = req.query;

  const organizationInfo: Record<string, object> = {};
  const allUsers = await getAllUsersFiltered(parseInt(page ?? "1"), search);
  if (allUsers?.length > 0) {
    for await (const user of allUsers) {
      const orgs = await findOrganizationsByMemberId(user.id);
      organizationInfo[user.id] = orgs.map((o) => ({
        id: o.id,
        name: o.name,
        members: o.members.length,
        role: o.members.find((m) => m.id === user.id)?.role,
      }));
    }
  }

  return res.status(200).json({
    status: 200,
    members: allUsers,
    total: await getTotalNumUsers(search),
    memberOrgs: organizationInfo,
  });
}

export async function putMember(
  req: AuthRequest<{
    userId: string;
    name: string;
    email: string;
    verified: boolean;
  }>,
  res: Response
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can update members",
    });
  }

  const { userId, email, verified, name } = req.body;
  const updates: Partial<UserInterface> = {};
  const orig: Partial<UserInterface> = {};
  const member = await getUserById(userId);
  if (!member) {
    return res.status(404).json({
      status: 404,
      message: "Member not found",
    });
  }
  if (email) {
    updates.email = email;
    orig.email = member.email;
  }
  if (name) {
    updates.name = name;
    orig.name = member.name;
  }
  if (verified !== member.verified) {
    updates.verified = verified;
    orig.verified = member.verified;
  }

  await updateUser(userId, updates);

  await req.audit({
    event: "team.update",
    entity: {
      object: "user",
      id: userId,
    },
    details: auditDetailsUpdate(orig, updates),
  });

  return res.status(200).json({
    status: 200,
  });
}
