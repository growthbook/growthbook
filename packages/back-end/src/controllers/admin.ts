import { Response } from "express";
import { parseIntWithDefault } from "shared/util";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import { UserInterface } from "shared/types/user";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { canSuperAdminWrite, SuperAdmin } from "shared/validators";
import {
  _dangerousCreateSSOConnection,
  _dangerousUpdateSSOConnection,
  _dangerousGetAllSSOConnections,
  _dangerousGetSSOConnectionById,
} from "back-end/src/models/SSOConnectionModel";
import {
  AdminUserFilters,
  getAllUsersFiltered,
  getTotalNumUsers,
  getUserById,
  getUsersByIds,
  updateUser,
} from "back-end/src/models/UserModel";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  AdminOrgMemberRange,
  AdminOrgPlanFilter,
  AdminOrgPlanQueryParam,
  AdminOrganizationPlanMode,
  findAllOrganizations,
  findOrganizationsByMemberIds,
  getOrganizationIdsWithLegacyEnterpriseFlag,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import { getOrganizationIdsFromLicensesWithPlans } from "back-end/src/enterprise/models/licenseModel";
import {
  getContextFromReq,
  getOrganizationById,
  setLicenseKey,
} from "back-end/src/services/organizations";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { _dangerourslyGetAllDatasourcesByOrganizations } from "back-end/src/models/DataSourceModel";
import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";
import { getSuperAdminOrganizationUsage } from "back-end/src/services/superAdminOrganizationUsage";

// Maps the coarse buckets exposed in the admin UI to the precise AccountPlan values.
const adminPlanGroups: Record<AdminOrgPlanFilter, ReadonlySet<string>> = {
  free: new Set(["oss", "starter"]),
  pro: new Set(["pro", "pro_sso"]),
  enterprise: new Set(["enterprise"]),
};

function buildPlanFilter(plans: AdminOrgPlanFilter[] | undefined) {
  if (!plans?.length) return undefined;
  const allowed = new Set<string>();
  for (const plan of plans) {
    for (const p of adminPlanGroups[plan] || []) allowed.add(p);
  }
  return (org: OrganizationInterface) =>
    allowed.has(getEffectiveAccountPlan(org));
}

async function resolveOrganizationPlanMode(
  plan: AdminOrgPlanQueryParam,
): Promise<AdminOrganizationPlanMode> {
  if (plan === "all") return { mode: "none" };
  if (plan === "free") {
    const predicate = buildPlanFilter(["free"]);
    return predicate ? { mode: "effective_free", predicate } : { mode: "none" };
  }
  if (plan === "pro") {
    const ids = await getOrganizationIdsFromLicensesWithPlans([
      "pro",
      "pro_sso",
    ]);
    return { mode: "id_in", ids };
  }
  if (plan === "enterprise") {
    const fromLicenses =
      await getOrganizationIdsFromLicensesWithPlans(["enterprise"]);
    const legacy = await getOrganizationIdsWithLegacyEnterpriseFlag();
    return {
      mode: "id_in",
      ids: [...new Set([...fromLicenses, ...legacy])],
    };
  }
  return { mode: "none" };
}

function parseCsvParam<T extends string>(
  raw: string | undefined,
  allowed: ReadonlySet<string>,
): T[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => allowed.has(v)) as T[];
  return values.length ? values : undefined;
}

const memberRangeSet: ReadonlySet<string> = new Set([
  "<5",
  "5-20",
  "20-50",
  "50+",
]);
function requireSuperAdminWrite(
  req: AuthRequest<unknown, unknown, unknown>,
  res: Response,
  action: string,
): boolean {
  if (!req.superAdmin) {
    res.status(403).json({
      status: 403,
      message: `Only superAdmins can ${action}`,
    });
    return false;
  }
  if (!canSuperAdminWrite(req.superAdmin)) {
    res.status(403).json({
      status: 403,
      message: `Read-only superAdmins cannot ${action}`,
    });
    return false;
  }
  return true;
}

export async function _dangerousAdminGetOrganizations(
  req: AuthRequest<
    never,
    never,
    {
      page?: string;
      search?: string;
      memberRanges?: string;
      plan?: string;
    }
  >,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all organizations",
    });
  }

  const { page, search, memberRanges, plan: planQuery } = req.query;

  const parsedMemberRanges = parseCsvParam<AdminOrgMemberRange>(
    memberRanges,
    memberRangeSet,
  );

  const planParam: AdminOrgPlanQueryParam =
    typeof planQuery === "string" &&
    ["all", "free", "pro", "enterprise"].includes(planQuery)
      ? (planQuery as AdminOrgPlanQueryParam)
      : "all";

  const planMode = await resolveOrganizationPlanMode(planParam);

  const { organizations, total } = await findAllOrganizations(
    parseIntWithDefault(page, 1),
    search || "",
    {
      memberRanges: parsedMemberRanges,
      plan: planMode,
    },
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
    messages?: OrganizationMessage[];
  }>,
  res: Response,
) {
  if (
    !requireSuperAdminWrite(req, res, "update organizations via admin page")
  ) {
    return;
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
  if (!requireSuperAdminWrite(req, res, "disable organizations")) {
    return;
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
  if (!requireSuperAdminWrite(req, res, "enable organizations")) {
    return;
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
  req: AuthRequest<
    never,
    never,
    { page?: string; search?: string; superAdmin?: string }
  >,
  res: Response,
) {
  if (!req.superAdmin) {
    return res.status(403).json({
      status: 403,
      message: "Only superAdmins can get all members",
    });
  }

  const { page, search, superAdmin } = req.query;
  const parsedPage = parseIntWithDefault(page, 1);
  const superAdminFilter =
    superAdmin === "yes" || superAdmin === "no" ? superAdmin : undefined;

  // When the search starts with `org_`, look up the org directly and pull its
  // members instead of regex-scanning the users collection.
  const trimmedSearch = (search || "").trim();
  const orgIdSearch = /^org_[a-z0-9_-]+$/i.test(trimmedSearch)
    ? trimmedSearch
    : null;

  if (orgIdSearch) {
    const org = await getOrganizationById(orgIdSearch);
    if (!org) {
      return res.status(200).json({
        status: 200,
        members: [],
        total: 0,
        memberOrgs: {},
      });
    }
    const memberIds = org.members.map((m) => m.id);
    const filteredUsers = memberIds.length
      ? await getAllUsersFiltered(parsedPage, {
          ids: memberIds,
          superAdmin: superAdminFilter,
        })
      : [];
    const total = memberIds.length
      ? await getTotalNumUsers({ ids: memberIds, superAdmin: superAdminFilter })
      : 0;
    const condensedOrg = {
      id: org.id,
      name: org.name,
      members: org.members.length,
    };
    const memberOrgs: Record<string, object> = {};
    filteredUsers.forEach((u) => {
      const role = org.members.find((m) => m.id === u.id)?.role;
      memberOrgs[u.id] = [{ ...condensedOrg, role }];
    });
    return res.status(200).json({
      status: 200,
      members: filteredUsers,
      total,
      memberOrgs,
    });
  }

  const filters: AdminUserFilters = {
    search: trimmedSearch,
    superAdmin: superAdminFilter,
  };

  const organizationInfo: Record<string, object> = {};
  const filteredUsers = await getAllUsersFiltered(parsedPage, filters);
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
    total: await getTotalNumUsers(filters),
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

export async function _dangerousAdminGetOrganizationUsage(
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
      message: "Only superAdmins can load organization usage",
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

  const usage = await getSuperAdminOrganizationUsage(org);

  return res.status(200).json({
    status: 200,
    usage,
  });
}

export async function _dangerousAdminPutMember(
  req: AuthRequest<{
    userId: string;
    name?: string;
    email?: string;
    verified?: boolean;
    superAdmin?: SuperAdmin;
  }>,
  res: Response,
) {
  if (!requireSuperAdminWrite(req, res, "update members")) {
    return;
  }

  const { userId, email, verified, name, superAdmin } = req.body;
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
  if (verified !== undefined && verified !== member.verified) {
    updates.verified = verified;
    orig.verified = member.verified;
  }
  if (superAdmin !== undefined && superAdmin !== (member.superAdmin ?? false)) {
    if (
      superAdmin !== true &&
      superAdmin !== false &&
      superAdmin !== "readonly"
    ) {
      return res.status(400).json({
        status: 400,
        message: "superAdmin must be true, false, or 'readonly'",
      });
    }
    // Guard against self-lockout: a super admin cannot change their own
    // super admin level (e.g. downgrading themselves to readonly or removing
    // it entirely would leave them unable to undo the change).
    if (userId === req.userId) {
      return res.status(400).json({
        status: 400,
        message: "You cannot change your own super admin status",
      });
    }
    updates.superAdmin = superAdmin;
    orig.superAdmin = member.superAdmin ?? false;
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
  if (!requireSuperAdminWrite(req, res, "upsert SSO connections")) {
    return;
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
