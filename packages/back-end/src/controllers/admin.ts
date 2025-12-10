import { Response } from "express";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { OrganizationInterface } from "back-end/types/organization";
import { UserInterface } from "back-end/types/user";
import {
  _dangerousCreateSSOConnection,
  _dangerouseUpdateSSOConnection,
  _dangerousGetAllSSOConnections,
  _dangerousGetSSOConnectionById,
} from "back-end/src/models/SSOConnectionModel";
import {
  getAllUsersFiltered,
  getTotalNumUsers,
  getUserById,
  getUsersByIds,
  updateUser,
} from "back-end/src/models/UserModel";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  findAllOrganizations,
  findOrganizationsByMemberIds,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  getContextFromReq,
  getOrganizationById,
} from "back-end/src/services/organizations";
import { setLicenseKey } from "back-end/src/routers/organizations/organizations.controller";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { _dangerourslyGetAllDatasourcesByOrganizations } from "back-end/src/models/DataSourceModel";

export async function _dangerousAdminGetOrganizations(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response,
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
    search || "",
  );

  const rawSSOs = await _dangerousGetAllSSOConnections();
  // we don't want to expose sensitive information, so strip out the clientSecret
  const ssoConnections = rawSSOs.map((sso) => {
    return {
      ...sso,
      clientSecret: "",
    };
  });

  const orgIds = organizations.map((o) => o.id);

  const datasources =
    await _dangerourslyGetAllDatasourcesByOrganizations(orgIds);

  return res.status(200).json({
    status: 200,
    organizations,
    ssoConnections,
    datasources,
    total,
  });
}

export async function _dangerousAdminPutOrganization(
  req: AuthRequest<{
    orgId: string;
    name: string;
    externalId: string;
    licenseKey: string;
    ownerEmail?: string;
    verifiedDomain?: string;
    autoApproveMembers?: boolean;
    enterprise?: boolean;
    freeSeats?: number;
  }>,
  res: Response,
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
    enterprise,
    freeSeats,
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
  if (licenseKey !== undefined && licenseKey.trim() !== org.licenseKey) {
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
  if (enterprise !== org.enterprise) {
    updates.enterprise = enterprise;
    orig.enterprise = org.enterprise;
  }
  if (freeSeats !== org.freeSeats) {
    updates.freeSeats = freeSeats;
    orig.freeSeats = org.freeSeats;
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

// delete organization - For now, we're just marking the organization as deleted
export async function _dangerousAdminDisableOrganization(
  req: AuthRequest<{ orgId: string }>,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can disable organizations",
    });
  }

  const updates: Partial<OrganizationInterface> = {};
  const orig: Partial<OrganizationInterface> = {};
  const { orgId } = req.body;
  const org = await getOrganizationById(orgId);

  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  updates.disabled = true;
  orig.disabled = org.disabled;

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "organization.disable",
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

export async function _dangerousAdminEnableOrganization(
  req: AuthRequest<{ orgId: string }>,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can enable organizations",
    });
  }

  const updates: Partial<OrganizationInterface> = {};
  const orig: Partial<OrganizationInterface> = {};
  const { orgId } = req.body;
  const org = await getOrganizationById(orgId);

  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  updates.disabled = false;
  orig.disabled = org.disabled;

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "organization.enable",
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
export async function _dangerousAdminGetMembers(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all members",
    });
  }

  const { page, search } = req.query;

  const organizationInfo: Record<string, object> = {};
  const filteredUsers = await getAllUsersFiltered(
    parseInt(page ?? "1"),
    search,
  );
  if (filteredUsers?.length > 0) {
    const memberOrgs = await findOrganizationsByMemberIds(
      filteredUsers.map((u) => u.id),
    );
    // create a map of all the orgs mapped to the member id to make the step below easier
    const orgMembers = new Map();
    memberOrgs.forEach((mo) => {
      mo.members.forEach((u) => {
        const condensedOrg = {
          id: mo.id,
          name: mo.name,
          members: mo.members.length,
          role: mo.members.find((m) => m.id === u.id)?.role,
        };
        if (orgMembers.has(u.id)) {
          orgMembers.set(u.id, [...orgMembers.get(u.id), condensedOrg]);
        } else {
          orgMembers.set(u.id, [condensedOrg]);
        }
      });
    });
    filteredUsers.forEach((user) => {
      organizationInfo[user.id] = orgMembers.get(user.id) ?? [];
    });
  }

  return res.status(200).json({
    status: 200,
    members: filteredUsers,
    total: await getTotalNumUsers(search),
    memberOrgs: organizationInfo,
  });
}

export async function _dangerousAdminGetOrganizationMembers(
  req: AuthRequest<
    null,
    {
      orgId: string;
    }
  >,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all members",
    });
  }
  const { orgId } = req.params;

  const org = await getOrganizationById(orgId);
  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  const members: UserInterface[] = await getUsersByIds(
    org.members.map((m) => m.id),
  );

  return res.status(200).json({
    status: 200,
    members,
  });
}

export async function _dangerousAdminPutMember(
  req: AuthRequest<{
    userId: string;
    name: string;
    email: string;
    verified: boolean;
  }>,
  res: Response,
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
    event: "user.update",
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

export async function _dangerousAdminUpsertSSOConnection(
  req: AuthRequest<
    SSOConnectionInterface & {
      enforceSSO: boolean;
    }
  >,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can upsert SSO connections",
    });
  }

  const context = getContextFromReq(req);

  const {
    clientId,
    clientSecret,
    id,
    organization,
    additionalScope,
    audience,
    metadata,
    baseURL,
    emailDomains,
    extraQueryParams,
    idpType,
    tenantId,
    enforceSSO,
  } = req.body;

  if (organization !== context.org.id) {
    throw new Error("SSO connection organization must match selected org");
  }

  const all = await _dangerousGetAllSSOConnections();
  const existing = all.find((sso) => sso.id === id);

  if (existing) {
    // Update existing SSO Connection
    const updates: Partial<SSOConnectionInterface> = {
      clientId,
      clientSecret,
      additionalScope,
      audience,
      metadata,
      baseURL,
      emailDomains,
      extraQueryParams,
      idpType,
      tenantId,
    };
    await _dangerouseUpdateSSOConnection(existing, updates);
    await req.audit({
      event: "ssoConnection.update",
      entity: {
        object: "ssoConnection",
        id: id || "",
      },
      details: auditDetailsUpdate(existing, updates),
    });
  } else {
    // Create new SSO Connection
    const ssoConnection = await _dangerousCreateSSOConnection({
      id,
      organization,
      clientId,
      clientSecret,
      additionalScope,
      audience,
      metadata,
      baseURL,
      emailDomains,
      extraQueryParams,
      idpType,
      tenantId,
    });
    await req.audit({
      event: "ssoConnection.create",
      entity: {
        object: "ssoConnection",
        id: ssoConnection.id || "",
      },
      details: auditDetailsCreate(ssoConnection),
    });
  }

  const currentEnforce = context.org.restrictLoginMethod === id;
  if (enforceSSO !== currentEnforce) {
    const newValue = enforceSSO ? id : "";
    await updateOrganization(context.org.id, {
      restrictLoginMethod: newValue,
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: context.org.id,
      },
      details: auditDetailsUpdate(
        { restrictLoginMethod: context.org.restrictLoginMethod },
        { restrictLoginMethod: newValue },
      ),
    });
  }

  res.status(200).json({
    status: 200,
  });
}
