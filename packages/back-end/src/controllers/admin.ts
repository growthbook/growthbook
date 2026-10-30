import { Response } from "express";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import pick from "lodash/pick";
import { parseIntWithDefault } from "shared/util";
import {
  canChangeSuperAdmin,
  hasSuperAdminPermission,
  holdsAllSuperAdminPermissions,
  normalizeSuperAdmin,
} from "shared/permissions";
import { SuperAdminPermission, superAdminValidator } from "shared/validators";
import { AdminOrgSummary, getAdminOrgSummary } from "shared/enterprise";
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
  _dangerousGetSSOConnectionsByOrganization,
  _dangerousSetSSOConnectionsDisabled,
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
  getOrganizationById,
  setLicenseKey,
} from "back-end/src/services/organizations";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { _dangerourslyGetAllDatasourcesByOrganizations } from "back-end/src/models/DataSourceModel";
import { licenseInit } from "back-end/src/enterprise";
import {
  _dangerousGetLicenseRefsByPlans,
  _dangerousGetLicenseRefsBySubscriptionStatus,
  getLicenseByKey,
  getLicensesByKeys,
} from "back-end/src/enterprise/models/licenseModel";
import {
  adminOrgFiltersValidator,
  buildAdminOrgQuery,
  getLicensePlansForFilter,
  isSubscriptionStatusFilter,
} from "back-end/src/util/adminOrgQuery";
import { ProjectModel } from "back-end/src/models/ProjectModel";
import { SavedGroupModel } from "back-end/src/models/SavedGroupModel";
import { _dangerousCountFeaturesByOrganization } from "back-end/src/models/FeatureModel";
import { _dangerousCountExperimentsByOrganization } from "back-end/src/models/ExperimentModel";
import { _dangerousCountSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";

function permissionDenied(res: Response, permission: SuperAdminPermission) {
  return res.status(403).json({
    status: 403,
    message: `This action requires the ${permission} super admin permission`,
  });
}

// Every field the admin page can change. Anything missing here is rejected.
const ORG_FIELD_PERMISSIONS: {
  [K in keyof OrganizationInterface]?: SuperAdminPermission;
} = {
  name: "metadata",
  externalId: "metadata",
  ownerEmail: "metadata",
  // Both control who can join the org, so they sit with SSO
  verifiedDomain: "sso",
  autoApproveMembers: "sso",
  restrictLoginMethod: "sso",
  licenseKey: "billing",
  enterprise: "billing",
  freeSeats: "billing",
  disableSelfServeBilling: "billing",
  suspended: "suspend",
  messages: "messages",
};

export async function _dangerousAdminGetOrganizations(
  req: AuthRequest<never, never, { page?: string; search?: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const { page, search } = req.query;

  const parsed = adminOrgFiltersValidator.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      status: 400,
      message: "Invalid organization filters",
    });
  }
  const filters = parsed.data;

  const [planLicenses, statusLicenses, ssoOrgIds] = await Promise.all([
    filters.plan
      ? _dangerousGetLicenseRefsByPlans(getLicensePlansForFilter(filters.plan))
      : undefined,
    isSubscriptionStatusFilter(filters.status)
      ? _dangerousGetLicenseRefsBySubscriptionStatus(filters.status)
      : undefined,
    filters.loginMethod === "sso" || filters.loginMethod === "none"
      ? _dangerousGetAllSSOConnections().then((connections) =>
          connections.flatMap((c) =>
            !c.disabled && c.organization ? [c.organization] : [],
          ),
        )
      : undefined,
  ]);

  const { organizations, total } = await findAllOrganizations(
    parseIntWithDefault(page, 1),
    search || "",
    50,
    buildAdminOrgQuery(filters, {
      plan: planLicenses,
      status: statusLicenses,
      ssoOrgIds,
    }),
    // Searches usually look for a big customer, not the newest signup
    search ? "members" : "newest",
  );

  const licenses = await getLicensesByKeys(
    organizations.flatMap((o) => (o.licenseKey ? [o.licenseKey] : [])),
  );
  const summaries: Record<string, AdminOrgSummary> = {};
  organizations.forEach((o) => {
    summaries[o.id] = getAdminOrgSummary(
      o,
      licenses.find((l) => l.id === o.licenseKey) ?? null,
    );
  });

  return res.status(200).json({
    status: 200,
    organizations,
    summaries,
    total,
  });
}

export async function _dangerousAdminGetOrganization(
  req: AuthRequest<null, { orgId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const org = await getOrganizationById(req.params.orgId);
  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  const [license, ssoConnections, datasources, ...counts] = await Promise.all([
    org.licenseKey ? getLicenseByKey(org.licenseKey) : null,
    _dangerousGetSSOConnectionsByOrganization(org.id),
    _dangerourslyGetAllDatasourcesByOrganizations([org.id]),
    ProjectModel._dangerousCountByOrganization(org.id),
    _dangerousCountFeaturesByOrganization(org.id),
    _dangerousCountExperimentsByOrganization(org.id),
    _dangerousCountSDKConnectionsByOrganization(org.id),
    SavedGroupModel._dangerousCountByOrganization(org.id),
  ]);
  const [projects, features, experiments, sdkConnections, savedGroups] = counts;

  return res.status(200).json({
    status: 200,
    organization: org,
    // From the cached license, like the list, so it shows before a live refresh
    summary: getAdminOrgSummary(org, license),
    // Strip the secret, like the SSO edit form expects
    ssoConnection: ssoConnections[0]
      ? { ...ssoConnections[0], clientSecret: "" }
      : null,
    datasources: datasources.map(({ id, name, type }) => ({ id, name, type })),
    counts: { projects, features, experiments, sdkConnections, savedGroups },
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
    restrictLoginMethod?: string;
    enterprise?: boolean;
    freeSeats?: number;
    disableSelfServeBilling?: boolean;
    suspended?: boolean;
    messages?: OrganizationMessage[];
  }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const {
    orgId,
    name,
    externalId,
    licenseKey,
    ownerEmail,
    verifiedDomain,
    autoApproveMembers,
    restrictLoginMethod,
    enterprise,
    freeSeats,
    disableSelfServeBilling,
    suspended,
    messages,
  } = req.body;
  const updates: Partial<OrganizationInterface> = {};
  const org = await getOrganizationById(orgId);

  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  // The edit form sends every field, so only real changes count; defaults
  // match how each field is read when unset.
  if (name && name !== org.name) {
    updates.name = name;
  }
  if (externalId !== undefined && externalId !== (org.externalId ?? "")) {
    updates.externalId = externalId;
  }
  if (
    licenseKey !== undefined &&
    licenseKey.trim() !== (org.licenseKey ?? "")
  ) {
    updates.licenseKey = licenseKey.trim();
  }
  if (ownerEmail && ownerEmail !== org.ownerEmail) {
    updates.ownerEmail = ownerEmail;
  }
  if (verifiedDomain && verifiedDomain !== org.verifiedDomain) {
    updates.verifiedDomain = verifiedDomain;
  }
  if (
    autoApproveMembers !== undefined &&
    autoApproveMembers !== (org.autoApproveMembers ?? false)
  ) {
    updates.autoApproveMembers = autoApproveMembers;
  }
  if (
    restrictLoginMethod !== undefined &&
    restrictLoginMethod.trim() !== (org.restrictLoginMethod ?? "")
  ) {
    const connectionId = restrictLoginMethod.trim();
    // Vercel orgs are bound to their installation
    if (
      org.restrictLoginMethod?.startsWith("vercel:") ||
      connectionId.startsWith("vercel:")
    ) {
      return res.status(400).json({
        status: 400,
        message: "The login method of a Vercel organization can't be changed.",
      });
    }
    // Can be another org's connection, e.g. a subsidiary that signs in
    // through its parent company's SSO
    if (connectionId) {
      const sso = await _dangerousGetSSOConnectionById(connectionId);
      if (!sso || sso.disabled) {
        return res.status(400).json({
          status: 400,
          message: `No active SSO connection with the ID "${connectionId}".`,
        });
      }
    }
    updates.restrictLoginMethod = connectionId;
  }
  if (enterprise !== undefined && enterprise !== (org.enterprise ?? false)) {
    updates.enterprise = enterprise;
  }
  if (freeSeats !== undefined && freeSeats !== (org.freeSeats ?? 3)) {
    updates.freeSeats = freeSeats;
  }
  if (
    disableSelfServeBilling !== undefined &&
    disableSelfServeBilling !== (org.disableSelfServeBilling ?? false)
  ) {
    updates.disableSelfServeBilling = disableSelfServeBilling;
  }
  if (suspended !== undefined && suspended !== (org.suspended ?? false)) {
    updates.suspended = suspended;
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
    }
  }

  // Authorize the whole change before any side effect
  for (const field of Object.keys(updates) as (keyof OrganizationInterface)[]) {
    const permission = ORG_FIELD_PERMISSIONS[field];
    if (!permission) {
      throw new Error(`Unexpected organization field: ${field}`);
    }
    if (!hasSuperAdminPermission(req.superAdmin, permission)) {
      return permissionDenied(res, permission);
    }
  }

  // Before setLicenseKey, which mutates `org`
  const orig = pick(org, Object.keys(updates));

  if (updates.licenseKey !== undefined) {
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

async function setSSOConnectionsDisabledWithAudit(
  req: AuthRequest<{ orgId: string }>,
  orgId: string,
  disabled: boolean,
) {
  const connections = await _dangerousGetSSOConnectionsByOrganization(orgId);
  const toUpdate = connections.filter((c) => !!c.disabled !== disabled);
  if (!toUpdate.length) return;

  await _dangerousSetSSOConnectionsDisabled(orgId, disabled);

  for (const connection of toUpdate) {
    await req.audit({
      event: "ssoConnection.update",
      entity: {
        object: "ssoConnection",
        id: connection.id || "",
      },
      details: auditDetailsUpdate(
        { disabled: connection.disabled },
        { disabled },
      ),
    });
  }
}

// delete organization - For now, we're just marking the organization as deleted
export async function _dangerousAdminDisableOrganization(
  req: AuthRequest<{ orgId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "suspend")) {
    return permissionDenied(res, "suspend");
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

  // Also disable the org's SSO connections so domain-based SSO lookups and
  // auto-joins can't route users into a disabled org
  await setSSOConnectionsDisabledWithAudit(req, org.id, true);

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
  if (!hasSuperAdminPermission(req.superAdmin, "suspend")) {
    return permissionDenied(res, "suspend");
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

  // Re-enable the org's SSO connections to mirror the disable behavior
  await setSSOConnectionsDisabledWithAudit(req, org.id, false);

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
  req: AuthRequest<
    never,
    never,
    { page?: string; search?: string; superAdmins?: string }
  >,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const { page, search } = req.query;
  const superAdminsOnly = req.query.superAdmins === "1";

  const filteredUsers = await getAllUsersFiltered(
    parseIntWithDefault(page, 1),
    search,
    superAdminsOnly,
  );

  return res.status(200).json({
    status: 200,
    members: filteredUsers,
    total: await getTotalNumUsers(search, superAdminsOnly),
  });
}

export async function _dangerousAdminGetUser(
  req: AuthRequest<null, { userId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const user = await getUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({
      status: 404,
      message: "User not found",
    });
  }

  const orgs = await findOrganizationsByMemberIds([user.id]);

  return res.status(200).json({
    status: 200,
    user: { ...user, passwordHash: "" },
    organizations: orgs.map((org) => {
      const member = org.members.find((m) => m.id === user.id);
      return {
        id: org.id,
        name: org.name,
        role: member?.role,
        lastLoginDate: member?.lastLoginDate,
      };
    }),
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
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
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
    members: members.map((m) => ({ ...m, passwordHash: "" })),
  });
}

// By org id rather than X-Organization, so it doesn't require impersonating
export async function _dangerousAdminGetOrganizationLicense(
  req: AuthRequest<null, { orgId: string }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const org = await getOrganizationById(req.params.orgId);
  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  // Force refresh, like GET /license, so the page shows current data
  const license = org.licenseKey
    ? await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true)
    : null;

  return res.status(200).json({
    status: 200,
    license,
  });
}

export async function _dangerousAdminPutMember(
  req: AuthRequest<{
    userId: string;
    name: string;
    email: string;
    verified: boolean;
    superAdmin?: unknown;
    resetAuthSubject?: boolean;
  }>,
  res: Response,
) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return permissionDenied(res, "view");
  }

  const { userId, email, verified, name, superAdmin, resetAuthSubject } =
    req.body;
  const updates: Partial<UserInterface> = {};
  const member = await getUserById(userId);
  if (!member) {
    return res.status(404).json({
      status: 404,
      message: "Member not found",
    });
  }
  if (email && email !== member.email) {
    updates.email = email;
  }
  if (name && name !== member.name) {
    updates.name = name;
  }
  if (
    typeof verified === "boolean" &&
    verified !== (member.verified ?? false)
  ) {
    updates.verified = verified;
  }
  // The bound identity belongs to the old email, so a new email starts unbound too
  if (
    (resetAuthSubject === true || updates.email !== undefined) &&
    member.authSubject
  ) {
    updates.authSubject = "";
  }
  // Either edit lets an unverified identity take over the account, so only full super admins can do it
  if (
    (updates.email !== undefined || updates.verified === false) &&
    req.superAdmin !== true
  ) {
    return res.status(403).json({
      status: 403,
      message:
        "Only full super admins can change a user's email or clear their verified status",
    });
  }
  if (
    Object.keys(updates).length &&
    !(
      hasSuperAdminPermission(req.superAdmin, "users") &&
      holdsAllSuperAdminPermissions(req.superAdmin, member.superAdmin)
    )
  ) {
    return permissionDenied(res, "users");
  }

  if (superAdmin !== undefined) {
    const parsed = superAdminValidator.safeParse(superAdmin);
    if (!parsed.success) {
      return res.status(400).json({
        status: 400,
        message: "Invalid super admin permissions",
      });
    }
    const next = normalizeSuperAdmin(parsed.data);
    if (!isEqual(next, normalizeSuperAdmin(member.superAdmin))) {
      // Guards against locking yourself out by accident
      if (member.id === req.userId) {
        return res.status(403).json({
          status: 403,
          message: "You cannot change your own super admin access",
        });
      }
      if (!canChangeSuperAdmin(req.superAdmin, member.superAdmin, next)) {
        return permissionDenied(res, "grant");
      }
      updates.superAdmin = next;
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(200).json({
      status: 200,
    });
  }

  const orig = pick(member, Object.keys(updates));
  await updateUser(userId, updates);

  // The IdP subject is an identifier, so the audit log only records whether one was bound
  const forAudit = (u: Partial<UserInterface>) =>
    u.authSubject === undefined
      ? u
      : { ...omit(u, "authSubject"), authSubjectBound: !!u.authSubject };
  await req.audit({
    event: "user.update",
    entity: {
      object: "user",
      id: userId,
    },
    details: auditDetailsUpdate(forAudit(orig), forAudit(updates)),
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
  if (!hasSuperAdminPermission(req.superAdmin, "sso")) {
    return permissionDenied(res, "sso");
  }

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

  // Taken from the body rather than X-Organization, so managing SSO doesn't
  // also require impersonating the org
  const org = organization ? await getOrganizationById(organization) : null;
  if (!org) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  const all = await _dangerousGetAllSSOConnections();
  const existing = all.find((sso) => sso.id === id);
  if (existing && existing.organization !== org.id) {
    throw new Error(
      `SSO connection "${id}" belongs to a different organization`,
    );
  }

  // An email domain must map to a single active SSO connection, otherwise
  // domain-based SSO lookups are ambiguous and can route users (and SSO
  // auto-joins) to the wrong organization
  const requestedDomains = new Set(
    (emailDomains || []).map((d) => d.trim().toLowerCase()).filter(Boolean),
  );
  for (const sso of all) {
    if (sso.id === id) continue;
    if (sso.disabled) continue;

    const overlap = (sso.emailDomains || []).filter((d) =>
      requestedDomains.has(d.trim().toLowerCase()),
    );
    if (!overlap.length) continue;

    // Connections pointing to disabled orgs can't be used to log in, so they
    // don't conflict (covers connections created before the disabled flag)
    const otherOrg = sso.organization
      ? await getOrganizationById(sso.organization)
      : null;
    if (otherOrg?.disabled) continue;

    throw new Error(
      `Email domain(s) ${overlap.join(", ")} already in use by SSO connection "${sso.id}" (org ${sso.organization}). Remove them there first, or disable that organization.`,
    );
  }

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

  const currentEnforce = org.restrictLoginMethod === id;
  if (enforceSSO !== currentEnforce) {
    const newValue = enforceSSO ? id : "";
    await updateOrganization(org.id, {
      restrictLoginMethod: newValue,
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(
        { restrictLoginMethod: org.restrictLoginMethod },
        { restrictLoginMethod: newValue },
      ),
    });
  }

  res.status(200).json({
    status: 200,
  });
}
