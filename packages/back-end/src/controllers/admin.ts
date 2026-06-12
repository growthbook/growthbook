import { Response } from "express";
import { parseIntWithDefault } from "shared/util";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import { UserInterface } from "shared/types/user";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import {
  _dangerousCreateSSOConnection,
  _dangerousUpdateSSOConnection,
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
  getContextForAgendaJobByOrgId,
  getContextFromReq,
  getOrganizationById,
  setLicenseKey,
} from "back-end/src/services/organizations";
import {
  applyOrgFeatureRepairs,
  planOrgFeatureRepairs,
  scanOrgFeatureRepairs,
} from "back-end/src/services/featureRepair";
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
    parseIntWithDefault(page, 1),
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
    disableSelfServeBilling?: boolean;
    suspended?: boolean;
    messages?: OrganizationMessage[];
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
    disableSelfServeBilling,
    suspended,
    messages,
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
  if (
    disableSelfServeBilling !== undefined &&
    disableSelfServeBilling !== org.disableSelfServeBilling
  ) {
    updates.disableSelfServeBilling = disableSelfServeBilling;
    orig.disableSelfServeBilling = org.disableSelfServeBilling;
  }
  if ((suspended ?? false) !== (org.suspended ?? false)) {
    updates.suspended = suspended;
    orig.suspended = org.suspended;
  }
  if (messages !== undefined) {
    const VALID_LEVELS = new Set(["info", "warning", "danger"]);
    if (
      !Array.isArray(messages) ||
      messages.some(
        (m) =>
          typeof m.message !== "string" ||
          m.message.trim() === "" ||
          !VALID_LEVELS.has(m.level),
      )
    ) {
      return res.status(400).json({
        status: 400,
        message:
          "Invalid messages: each entry must have a non-empty string message and a level of 'info', 'warning', or 'danger'.",
      });
    }
    if (JSON.stringify(messages) !== JSON.stringify(org.messages ?? [])) {
      updates.messages = messages;
      orig.messages = org.messages;
    }
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
    parseIntWithDefault(page, 1),
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

// Feature repair tooling: detects and fixes features/revisions left in
// inconsistent or legacy on-disk shapes for a single org. Superadmin-only.

export async function _dangerousAdminFeatureRepairScan(
  req: AuthRequest<never, { orgId: string }>,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can scan org features",
    });
  }

  const context = await getContextForAgendaJobByOrgId(req.params.orgId);
  const result = await scanOrgFeatureRepairs(context);

  return res.status(200).json({
    status: 200,
    ...result,
  });
}

export async function _dangerousAdminFeatureRepairDryRun(
  req: AuthRequest<
    { featureIds?: string[]; page?: number; limit?: number },
    { orgId: string }
  >,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can dry-run feature repairs",
    });
  }

  const { featureIds, page, limit } = req.body;
  if (
    featureIds !== undefined &&
    (!Array.isArray(featureIds) ||
      featureIds.some((id) => typeof id !== "string"))
  ) {
    return res.status(400).json({
      status: 400,
      message: "featureIds must be an array of strings",
    });
  }

  const context = await getContextForAgendaJobByOrgId(req.params.orgId);
  const result = await planOrgFeatureRepairs(context, {
    featureIds,
    page: typeof page === "number" && page > 0 ? Math.floor(page) : 1,
    limit:
      typeof limit === "number" && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : 10,
  });

  return res.status(200).json({
    status: 200,
    ...result,
  });
}

export async function _dangerousAdminFeatureRepairApply(
  req: AuthRequest<{ featureIds?: string[]; mode?: string }, { orgId: string }>,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can apply feature repairs",
    });
  }

  const { featureIds, mode } = req.body;
  if (
    featureIds !== undefined &&
    (!Array.isArray(featureIds) ||
      featureIds.some((id) => typeof id !== "string"))
  ) {
    return res.status(400).json({
      status: 400,
      message: "featureIds must be an array of strings",
    });
  }
  if (mode !== "drift" && mode !== "corruptDrafts") {
    return res.status(400).json({
      status: 400,
      message: 'mode must be "drift" or "corruptDrafts"',
    });
  }

  const context = await getContextForAgendaJobByOrgId(req.params.orgId);
  // The job context has no user identity; attribute audit entries (e.g. the
  // drift repair's feature.update) to the acting superadmin instead of
  // recording them as anonymous system actions.
  context.userId = req.userId || "";
  context.email = req.email || "";
  context.userName = req.name || "";
  context.auditUser = {
    type: "dashboard",
    id: req.userId || "",
    email: req.email || "",
    name: req.name || "",
  };
  const results = await applyOrgFeatureRepairs(context, {
    featureIds,
    mode,
    repairedBy: req.email || "unknown superadmin",
  });

  return res.status(200).json({
    status: 200,
    results,
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
    await _dangerousUpdateSSOConnection(existing, updates);
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
