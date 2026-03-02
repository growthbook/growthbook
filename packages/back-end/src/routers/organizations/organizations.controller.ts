import { Response } from "express";
import { cloneDeep } from "lodash";
import { freeEmailDomains } from "free-email-domains-typescript";
import { experimentHasLinkedChanges } from "shared/util";
import {
  getRoles,
  areProjectRolesValid,
  isRoleValid,
  getDefaultRole,
} from "shared/permissions";
import uniqid from "uniqid";
import { LicenseInterface, accountFeatures } from "shared/enterprise";
import { AgreementType, updateSdkWebhookValidator } from "shared/validators";
import { entityTypes } from "shared/constants";
import { UpdateSdkWebhookProps } from "shared/types/webhook";
import {
  GetOrganizationResponse,
  CreateOrganizationPostBody,
  Invite,
  MemberRoleWithProjects,
  NamespaceUsage,
  OrganizationInterface,
  OrganizationSettings,
  ProjectMemberRole,
  Role,
  SDKAttribute,
} from "shared/types/organization";
import { ExperimentRule, NamespaceValue } from "shared/types/feature";
import { TeamInterface } from "shared/types/team";
import { getWatchedByUser } from "back-end/src/models/WatchModel";
import { validateRoleAndEnvs } from "back-end/src/api/members/updateMemberRole";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import {
  acceptInvite,
  addMemberToOrg,
  addPendingMemberToOrg,
  expandOrgMembers,
  findVerifiedOrgsForNewUser,
  getContextFromReq,
  getInviteUrl,
  getMembersOfTeam,
  getNumberOfUniqueMembersAndInvites,
  importConfig,
  inviteUser,
  isEnterpriseSSO,
  removeMember,
  revokeInvite,
} from "back-end/src/services/organizations";
import {
  getNonSensitiveParams,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import { updatePassword } from "back-end/src/services/users";
import { getAllTags } from "back-end/src/models/TagModel";
import {
  auditDetailsUpdate,
  getRecentWatchedAudits,
  isValidAuditEntityType,
} from "back-end/src/services/audit";
import {
  getAllFeatures,
  hasNonDemoFeature,
} from "back-end/src/models/FeatureModel";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import {
  ALLOW_SELF_ORG_CREATION,
  APP_ORIGIN,
  IS_CLOUD,
  IS_MULTI_ORG,
} from "back-end/src/util/secrets";
import {
  sendInviteEmail,
  sendNewMemberEmail,
  sendPendingMemberEmail,
  sendNewOrgEmail,
  sendPendingMemberApprovalEmail,
  sendOwnerEmailChangeEmail,
} from "back-end/src/services/email";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { getMetricsByOrganization } from "back-end/src/models/MetricModel";
import {
  createOrganization,
  findOrganizationByInviteKey,
  findAllOrganizations,
  findOrganizationsByMemberId,
  hasOrganization,
  updateOrganization,
  addCustomRole,
  editCustomRole,
  removeCustomRole,
  deactivateRoleById,
  activateRoleById,
  addGetStartedChecklistItem,
} from "back-end/src/models/OrganizationModel";
import { ConfigFile } from "back-end/src/init/config";
import { usingOpenId } from "back-end/src/services/auth";
import { getSSOConnectionSummary } from "back-end/src/models/SSOConnectionModel";
import {
  createOrganizationApiKey,
  createUserPersonalAccessApiKey,
  deleteApiKeyById,
  deleteApiKeyByKey,
  getAllApiKeysByOrganization,
  getApiKeyByIdOrKey,
  getUnredactedSecretKey,
} from "back-end/src/models/ApiKeyModel";
import { getUserPermissions } from "back-end/src/util/organization.util";
import {
  deleteUser,
  getUserById,
  getAllUsers,
  getUserByEmail,
} from "back-end/src/models/UserModel";
import {
  getAllExperiments,
  getExperimentsForActivityFeed,
  hasNonDemoExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  findAllAuditsByEntityType,
  findAllAuditsByEntityTypeParent,
  findAuditByEntity,
  findAuditByEntityParent,
  countAuditByEntity,
  countAuditByEntityParent,
  countAllAuditsByEntityType,
  countAllAuditsByEntityTypeParent,
} from "back-end/src/models/AuditModel";
import { getAllFactTablesForOrganization } from "back-end/src/models/FactTableModel";
import { fireSdkWebhook } from "back-end/src/jobs/sdkWebhooks";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { findSDKConnectionsByIds } from "back-end/src/models/SdkConnectionModel";
import {
  getLicense,
  licenseInit,
  getLowestPlanPerFeature,
  getAccountPlan,
  getEffectiveAccountPlan,
  getLicenseError,
  getSubscriptionFromLicense,
  orgHasPremiumFeature,
} from "back-end/src/enterprise";
import { getUsageFromCache } from "back-end/src/enterprise/billing";
import { logger } from "back-end/src/util/logger";
import {
  getInstallation,
  setInstallationName,
} from "back-end/src/models/InstallationModel";

export async function getDefinitions(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const orgId = context.org.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }

  const [
    metrics,
    datasources,
    dimensions,
    segments,
    metricGroups,
    tags,
    savedGroups,
    customFields,
    projects,
    factTables,
    factMetrics,
    decisionCriteria,
    webhookSecrets,
  ] = await Promise.all([
    getMetricsByOrganization(context),
    getDataSourcesByOrganization(context),
    findDimensionsByOrganization(orgId),
    context.models.segments.getAll(),
    context.models.metricGroups.getAll(),
    getAllTags(orgId),
    context.models.savedGroups.getAllWithoutValues(),
    context.models.customFields.getCustomFields(),
    context.models.projects.getAll(),
    getAllFactTablesForOrganization(context),
    context.models.factMetrics.getAll(),
    context.models.decisionCriteria.getAll(),
    context.models.webhookSecrets.getAllForFrontEnd(),
  ]);

  return res.status(200).json({
    status: 200,
    metrics,
    datasources: datasources.map((d) => {
      const integration = getSourceIntegrationObject(context, d);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        type: d.type,
        settings: d.settings,
        params: getNonSensitiveParams(integration),
        projects: d.projects || [],
        properties: integration.getSourceProperties(),
        decryptionError: integration.decryptionError || false,
        dateCreated: d.dateCreated,
        dateUpdated: d.dateUpdated,
      };
    }),
    dimensions,
    segments,
    metricGroups,
    tags,
    savedGroups,
    customFields: customFields?.fields ?? [],
    projects,
    factTables,
    factMetrics,
    decisionCriteria,
    webhookSecrets,
  });
}

export async function getActivityFeed(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  try {
    const docs = await getRecentWatchedAudits(userId, org.id);

    if (!docs.length) {
      return res.status(200).json({
        status: 200,
        events: [],
        experiments: [],
        features: [],
      });
    }

    const experimentIds = Array.from(new Set(docs.map((d) => d.entity.id)));
    const experiments = await getExperimentsForActivityFeed(
      context,
      experimentIds,
    );

    res.status(200).json({
      status: 200,
      events: docs,
      experiments,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getAllHistory(
  req: AuthRequest<null, { type: string }, { cursor?: string; limit?: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { type } = req.params;
  const limit = Math.min(parseInt(req.query.limit || "50"), 100); // Max 100 per page
  const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

  if (!isValidAuditEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message: `${type} is not a valid entity type. Possible entity types are: ${entityTypes}`,
    });
  }

  // Get total count for display
  const [entityCount, parentCount] = await Promise.all([
    countAllAuditsByEntityType(org.id, type),
    countAllAuditsByEntityTypeParent(org.id, type),
  ]);
  const total = entityCount + parentCount;

  const cursorFilter = cursor ? { dateCreated: { $lt: cursor } } : undefined;
  const fetchLimit = limit;

  const events = await Promise.all([
    findAllAuditsByEntityType(
      org.id,
      type,
      {
        limit: fetchLimit,
        sort: { dateCreated: -1 },
      },
      cursorFilter,
    ),
    findAllAuditsByEntityTypeParent(
      org.id,
      type,
      {
        limit: fetchLimit,
        sort: { dateCreated: -1 },
      },
      cursorFilter,
    ),
  ]);

  // Merge and sort by dateCreated descending
  const merged = [...events[0], ...events[1]];
  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  // Take only the requested limit
  const paginatedEvents = merged.slice(0, limit);

  if (paginatedEvents.filter((e) => e.organization !== org.id).length > 0) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to view history",
    });
  }

  // The next cursor is the dateCreated of the last event
  const nextCursor =
    paginatedEvents.length > 0
      ? paginatedEvents[paginatedEvents.length - 1].dateCreated
      : null;

  res.status(200).json({
    status: 200,
    events: paginatedEvents,
    total,
    nextCursor,
  });
}

export async function getHistory(
  req: AuthRequest<
    null,
    { type: string; id: string },
    { cursor?: string; limit?: string }
  >,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { type, id } = req.params;
  const limit = Math.min(parseInt(req.query.limit || "50"), 100); // Max 100 per page
  const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

  if (!isValidAuditEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message: `${type} is not a valid entity type. Possible entity types are: ${entityTypes}`,
    });
  }

  // Get total count for display
  const [entityCount, parentCount] = await Promise.all([
    countAuditByEntity(org.id, type, id),
    countAuditByEntityParent(org.id, type, id),
  ]);
  const total = entityCount + parentCount;

  const cursorFilter = cursor ? { dateCreated: { $lt: cursor } } : undefined;

  const fetchLimit = limit;

  const events = await Promise.all([
    findAuditByEntity(
      org.id,
      type,
      id,
      {
        limit: fetchLimit,
        sort: { dateCreated: -1 },
      },
      cursorFilter,
    ),
    findAuditByEntityParent(
      org.id,
      type,
      id,
      {
        limit: fetchLimit,
        sort: { dateCreated: -1 },
      },
      cursorFilter,
    ),
  ]);

  // Merge and sort by dateCreated descending
  const merged = [...events[0], ...events[1]];
  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  // Take only the requested limit
  const paginatedEvents = merged.slice(0, limit);

  if (paginatedEvents.filter((e) => e.organization !== org.id).length > 0) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to view history for this",
    });
  }

  // The next cursor is the dateCreated of the last event
  const nextCursor =
    paginatedEvents.length > 0
      ? paginatedEvents[paginatedEvents.length - 1].dateCreated
      : null;

  res.status(200).json({
    status: 200,
    events: paginatedEvents,
    total,
    nextCursor,
  });
}

export async function putMemberRole(
  req: AuthRequest<MemberRoleWithProjects, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }
  const { org, userId } = context;
  const { role, limitAccessByEnvironment, environments, projectRoles } =
    req.body;
  const { id } = req.params;

  if (id === userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
    });
  }

  if (!isRoleValid(role, org) || !areProjectRolesValid(projectRoles, org)) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  let found = false;
  org.members.forEach((m) => {
    if (m.id === id) {
      m.role = role;
      m.limitAccessByEnvironment = !!limitAccessByEnvironment;
      m.environments = environments || [];
      m.projectRoles = projectRoles || [];
      found = true;
    }
  });
  org?.pendingMembers?.forEach((m) => {
    if (m.id === id) {
      m.role = role;
      m.limitAccessByEnvironment = !!limitAccessByEnvironment;
      m.environments = environments || [];
      m.projectRoles = projectRoles || [];
      found = true;
    }
  });

  if (!found) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find member",
    });
  }

  try {
    await updateOrganization(org.id, {
      members: org.members,
      pendingMembers: org.pendingMembers,
    });
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to change role",
    });
  }
}

export async function putMemberProjectRole(
  req: AuthRequest<{ projectRole: ProjectMemberRole }, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const { org, userId } = context;
  const { projectRole } = req.body;
  const { id } = req.params;

  // Project-admins can update project roles for their project - so we check if they have the canUpdateProject permission
  // rather than the canManageTeam permission
  if (!context.permissions.canUpdateProject(projectRole.project)) {
    context.permissions.throwPermissionError();
  }

  if (id === userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
    });
  }

  if (!orgHasPremiumFeature(org, "advanced-permissions")) {
    return res.status(400).json({
      status: 400,
      message:
        "Your plan does not support providing users with project-level permissions.",
    });
  }

  // Validate the project role
  const { memberIsValid, reason } = validateRoleAndEnvs(
    org,
    projectRole.role,
    projectRole.limitAccessByEnvironment || false,
    projectRole.environments,
  );

  if (!memberIsValid) {
    return res.status(400).json({
      status: 400,
      message: reason,
    });
  }
  const updatedProjectRole: ProjectMemberRole = {
    ...projectRole,
  };

  let found = false;
  org.members.forEach((m) => {
    if (m.id === id) {
      if (!m.projectRoles) {
        m.projectRoles = [];
      }
      // Check if project role already exists
      const existingIndex = m.projectRoles.findIndex(
        (pr) => pr.project === projectRole.project,
      );
      if (existingIndex >= 0) {
        // Update existing project role
        m.projectRoles[existingIndex] = updatedProjectRole;
      } else {
        // Add new project role
        m.projectRoles.push(updatedProjectRole);
      }
      found = true;
    }
  });

  if (!found) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find member",
    });
  }

  try {
    await updateOrganization(org.id, {
      members: org.members,
    });
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to update project role",
    });
  }
}

export async function putMember(
  req: AuthRequest<{
    orgId: string;
  }>,
  res: Response,
) {
  if (!req.userId || !req.email) {
    throw new Error("Must be logged in");
  }
  const { orgId } = req.body;
  if (!orgId) {
    throw new Error("Must provide orgId");
  }
  if (!req.verified) {
    throw new Error("User is not verified");
  }

  // ensure org matches one of the calculated verified org
  const organizations = await findVerifiedOrgsForNewUser(req.email);
  if (!organizations) {
    throw new Error("Invalid orgId");
  }

  const organization = organizations.find((o) => o.id === orgId);
  if (!organization) {
    throw new Error("Invalid orgId");
  }

  // check if user is already a member
  const existingMember = organization.members.find((m) => m.id === req.userId);
  if (existingMember) {
    return res.status(200).json({
      status: 200,
      message: "User is already a member of organization",
    });
  }

  try {
    const invite: Invite | undefined = organization.invites.find(
      (inv) => inv.email === req.email,
    );
    if (invite) {
      // if user already invited, accept invite
      await acceptInvite(invite.key, req.userId);
    } else if (organization.autoApproveMembers) {
      // if auto approve, add user as member
      await addMemberToOrg({
        organization,
        userId: req.userId,
        ...getDefaultRole(organization),
      });
    } else {
      // otherwise, add user as pending member
      await addPendingMemberToOrg({
        organization,
        name: req.name || "",
        userId: req.userId,
        email: req.email,
        ...getDefaultRole(organization),
      });

      try {
        const teamUrl = APP_ORIGIN + "/settings/team/?org=" + orgId;
        await sendPendingMemberEmail(
          req.name || "",
          req.email || "",
          organization.name,
          organization.ownerEmail,
          teamUrl,
        );
      } catch (e) {
        req.log.error(e, "Failed to send pending member email");
      }

      return res.status(200).json({
        status: 200,
        isPending: true,
        message: "Successfully added pending member to organization",
      });
    }

    try {
      await sendNewMemberEmail(
        req.name || "",
        req.email || "",
        organization.name,
        organization.ownerEmail,
      );
    } catch (e) {
      req.log.error(e, "Failed to send new member email");
    }

    return res.status(200).json({
      status: 200,
      message: "Successfully added member to organization",
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to add member to organization",
    });
  }
}

export async function postMemberApproval(
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { id } = req.params;

  const pendingMember = org?.pendingMembers?.find((m) => m.id === id);
  if (!pendingMember) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find pending member",
    });
  }

  try {
    await addMemberToOrg({
      organization: org,
      userId: pendingMember.id,
      role: pendingMember.role,
      limitAccessByEnvironment: pendingMember.limitAccessByEnvironment,
      environments: pendingMember.environments,
      projectRoles: pendingMember.projectRoles,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to approve member",
    });
  }

  try {
    const url = APP_ORIGIN + "/?org=" + org.id;
    await sendPendingMemberApprovalEmail(
      pendingMember.name || "",
      pendingMember.email || "",
      org.name,
      url,
    );
  } catch (e) {
    req.log.error(e, "Failed to send pending member approval email");
  }

  return res.status(200).json({
    status: 200,
    message: "Successfully added member to organization",
  });
}

export async function postAutoApproveMembers(
  req: AuthRequest<{ state: boolean }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;
  const { state } = req.body;

  try {
    await updateOrganization(org.id, {
      autoApproveMembers: state,
    });
    return res.status(200).json({
      status: 200,
      message: "Successfully updated auto approve members",
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to update auto approve members",
    });
  }
}

export async function putInviteRole(
  req: AuthRequest<MemberRoleWithProjects, { key: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { role, limitAccessByEnvironment, environments, projectRoles } =
    req.body;
  const { key } = req.params;
  const originalInvites: Invite[] = cloneDeep(org.invites);

  if (!isRoleValid(role, org) || !areProjectRolesValid(projectRoles, org)) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  let found = false;

  org.invites.forEach((m) => {
    if (m.key === key) {
      m.role = role;
      m.limitAccessByEnvironment = !!limitAccessByEnvironment;
      m.environments = environments || [];
      m.projectRoles = projectRoles || [];
      found = true;
    }
  });

  if (!found) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find member",
    });
  }

  try {
    await updateOrganization(org.id, {
      invites: org.invites,
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(
        { invites: originalInvites },
        { invites: org.invites },
      ),
    });
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Failed to change role",
    });
  }
}

export async function getOrganization(
  req: AuthRequest,
  res: Response<GetOrganizationResponse | { status: 200; organization: null }>,
) {
  if (!req.organization) {
    return res.status(200).json({
      status: 200,
      organization: null,
    });
  }
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const {
    invites,
    members,
    ownerEmail,
    demographicData,
    name,
    id,
    url,
    freeSeats,
    settings,
    disableSelfServeBilling,
    licenseKey,
    messages,
    externalId,
    setupEventTracker,
    isVercelIntegration,
  } = org;

  let license: Partial<LicenseInterface> | null = null;
  if (licenseKey || process.env.LICENSE_KEY) {
    // automatically set the license data based on org license key
    license = getLicense(licenseKey || process.env.LICENSE_KEY);
    if (!license || (license.organizationId && license.organizationId !== id)) {
      try {
        license =
          (await licenseInit(org, getUserCodesForOrg, getLicenseMetaData)) ||
          null;
      } catch (e) {
        logger.error(e, "setting license failed");
      }
    }
  }

  const installationName = (await getLicenseMetaData())?.installationName;

  const filteredAttributes = settings?.attributeSchema?.filter((attribute) =>
    context.permissions.canReadMultiProjectResource(attribute.projects),
  );

  const filteredEnvironments = settings?.environments?.filter((environment) =>
    context.permissions.canReadMultiProjectResource(environment.projects),
  );

  // Use a stripped down list of invites if the user doesn't have permission to manage the team
  // The full invite object contains a key which can be used to accept the invite
  // Without this filtering, a user could accept an invite of a higher-priveleged user and assume their role
  const filteredInvites = context.permissions.canManageTeam()
    ? invites
    : invites.map((i) => ({ email: i.email }));

  // Some other global org data needed by the front-end
  const apiKeys = await getAllApiKeysByOrganization(context);
  const enterpriseSSO = isEnterpriseSSO(req.loginMethod)
    ? getSSOConnectionSummary(req.loginMethod)
    : null;

  const expandedMembers = await expandOrgMembers(members, userId);

  const teams = await context.models.teams.getAll();

  const teamsWithMembers: TeamInterface[] = teams.map((team) => {
    const memberIds = getMembersOfTeam(org, team.id);
    return {
      ...team,
      members: memberIds,
    };
  });

  const currentUserPermissions = getUserPermissions(
    req.currentUser,
    org,
    teams || [],
  );
  const agreements = await context.models.agreements.getAll();
  const agreementsAgreed = Array.from(
    new Set(agreements.map((a) => a.agreement as AgreementType)),
  );
  const seatsInUse = getNumberOfUniqueMembersAndInvites(org);

  const watch = await getWatchedByUser(org.id, userId);

  const commercialFeatureLowestPlan = getLowestPlanPerFeature(accountFeatures);

  return res.status(200).json({
    status: 200,
    apiKeys,
    enterpriseSSO,
    accountPlan: getAccountPlan(org),
    effectiveAccountPlan: getEffectiveAccountPlan(org),
    licenseError: getLicenseError(org),
    commercialFeatures: [...accountFeatures[getEffectiveAccountPlan(org)]],
    commercialFeatureLowestPlan: commercialFeatureLowestPlan,
    roles: getRoles(org),
    members: expandedMembers,
    currentUserPermissions,
    teams: teamsWithMembers,
    license,
    installationName: installationName || null,
    subscription: license ? getSubscriptionFromLicense(license) : null,
    agreements: agreementsAgreed || [],
    watching: {
      experiments: watch?.experiments || [],
      features: watch?.features || [],
    },
    organization: {
      invites: filteredInvites as Invite[],
      ownerEmail,
      demographicData,
      externalId,
      name,
      id,
      url,
      licenseKey,
      freeSeats,
      enterprise: org.enterprise,
      disableSelfServeBilling,
      freeTrialDate: org.freeTrialDate,
      discountCode: org.discountCode || "",
      customRoles: org.customRoles,
      deactivatedRoles: org.deactivatedRoles,
      isVercelIntegration,
      settings: {
        ...settings,
        attributeSchema: filteredAttributes,
        environments: filteredEnvironments,
      },
      autoApproveMembers: org.autoApproveMembers,
      members: org.members,
      messages: messages || [],
      pendingMembers: org.pendingMembers,
      getStartedChecklistItems: org.getStartedChecklistItems,
      setupEventTracker,
      dateCreated: org.dateCreated,
    },
    seatsInUse,
    usage: getUsageFromCache(org),
  });
}

export async function getNamespaces(req: AuthRequest, res: Response) {
  if (!req.organization) {
    return res.status(200).json({
      status: 200,
      organization: null,
    });
  }
  const context = getContextFromReq(req);
  const { environments } = context;

  const namespaces: NamespaceUsage = {};

  // Get active legacy experiment rules on features
  const allFeatures = await getAllFeatures(context);
  allFeatures.forEach((f) => {
    if (f.archived) return;
    environments.forEach((env) => {
      if (!f.environmentSettings?.[env]?.enabled) return;
      const rules = f.environmentSettings?.[env]?.rules || [];
      rules
        .filter(
          (r) =>
            r.enabled &&
            r.type === "experiment" &&
            r.namespace &&
            r.namespace.enabled,
        )
        .forEach((r: ExperimentRule) => {
          const { name, range } = r.namespace as NamespaceValue;
          namespaces[name] = namespaces[name] || [];
          namespaces[name].push({
            link: `/features/${f.id}`,
            name: f.id,
            id: f.id,
            trackingKey: r.trackingKey || f.id,
            start: range[0],
            end: range[1],
            environment: env,
          });
        });
    });
  });

  const allExperiments = await getAllExperiments(context);
  allExperiments.forEach((e) => {
    if (e.archived) return;

    // Skip experiments that are not linked to any changes since they aren't included in the payload
    if (!experimentHasLinkedChanges(e)) return;

    // Skip if experiment is stopped and doesn't have a temporary rollout enabled
    if (
      e.status === "stopped" &&
      (e.excludeFromPayload || !e.releasedVariationId)
    ) {
      return;
    }

    // Skip if a namespace isn't enabled on the latest phase
    if (!e.phases) return;
    const phase = e.phases[e.phases.length - 1];
    if (!phase) return;
    if (!phase.namespace || !phase.namespace.enabled) return;

    const { name, range } = phase.namespace;
    namespaces[name] = namespaces[name] || [];
    namespaces[name].push({
      link: `/experiment/${e.id}`,
      name: e.name,
      id: e.trackingKey,
      trackingKey: e.trackingKey,
      start: range[0],
      end: range[1],
      environment: "",
    });
  });

  res.status(200).json({
    status: 200,
    namespaces,
  });
  return;
}

export async function postNamespaces(
  req: AuthRequest<{
    label: string;
    description: string;
    status: "active" | "inactive";
  }>,
  res: Response,
) {
  const { label, description, status } = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateNamespace()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  const namespaces = org.settings?.namespaces || [];

  // Namespace with the same name already exists
  if (namespaces.filter((n) => n.label === label).length > 0) {
    throw new Error("A namespace with this name already exists.");
  }

  // Create a unique id for this new namespace - We might want to clean this
  // up later, but for now, 'name' is the unique identifier, and 'label' is
  // the display name.
  const name = uniqid("ns-");
  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: [...namespaces, { name, label, description, status }],
    },
  });

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { namespaces } },
      {
        settings: {
          namespaces: [...namespaces, { name, description, status }],
        },
      },
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putNamespaces(
  req: AuthRequest<
    {
      label: string;
      description: string;
      status: "active" | "inactive";
    },
    { name: string }
  >,
  res: Response,
) {
  const { label, description, status } = req.body;
  const { name } = req.params;

  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateNamespace()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  const namespaces = org.settings?.namespaces || [];

  // Make sure this namespace exists
  if (namespaces.filter((n) => n.name === name).length === 0) {
    throw new Error("Namespace not found.");
  }

  const updatedNamespaces = namespaces.map((n) => {
    if (n.name === name) {
      // cannot update the 'name' (id) of a namespace
      return { label, name: n.name, description, status };
    }
    return n;
  });

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: updatedNamespaces,
    },
  });

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { namespaces } },
      { settings: { namespaces: updatedNamespaces } },
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function deleteNamespace(
  req: AuthRequest<null, { name: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteNamespace()) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;
  const { name } = req.params;

  const namespaces = org.settings?.namespaces || [];

  const updatedNamespaces = namespaces.filter((n) => {
    return n.name !== name;
  });

  if (namespaces.length === updatedNamespaces.length) {
    throw new Error("Namespace not found.");
  }

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: updatedNamespaces,
    },
  });

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { namespaces } },
      { settings: { namespaces: updatedNamespaces } },
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function getInviteInfo(
  req: AuthRequest<unknown, { key: string }>,
  res: ResponseWithStatusAndError<{ organization: string; role: string }>,
) {
  const { key } = req.params;

  try {
    if (!req.userId) {
      throw new Error("Must be logged in");
    }
    const org = await findOrganizationByInviteKey(key);

    if (!org) {
      throw new Error("Invalid or expired invitation key");
    }

    const invite = org.invites.find((i) => i.key === key);
    if (!invite) {
      throw new Error("Invalid or expired invitation key");
    }

    return res.status(200).json({
      status: 200,
      organization: org.name,
      role: invite.role,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postInviteAccept(
  req: AuthRequest<{ key: string }>,
  res: Response,
) {
  const { key } = req.body;

  try {
    if (!req.userId) {
      throw new Error("Must be logged in");
    }
    const org = await acceptInvite(key, req.userId);
    await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);

    return res.status(200).json({
      status: 200,
      orgId: org.id,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postInvite(
  req: AuthRequest<
    {
      email: string;
    } & MemberRoleWithProjects
  >,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { email, role, limitAccessByEnvironment, environments, projectRoles } =
    req.body;

  // Make sure role is valid
  if (!isRoleValid(role, org) || !areProjectRolesValid(projectRoles, org)) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  const license = getLicense();
  if (
    license &&
    license.hardCap &&
    getNumberOfUniqueMembersAndInvites(org) >= (license.seats || 0)
  ) {
    throw new Error(
      "Whoops! You've reached the seat limit on your license. Please contact sales@growthbook.io to increase your seat limit.",
    );
  }

  const { emailSent, inviteUrl } = await inviteUser({
    organization: org,
    email,
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  });

  return res.status(200).json({
    status: 200,
    inviteUrl,
    emailSent,
  });
}

export async function deleteMember(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org, userId } = context;
  const { id } = req.params;

  if (id === userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
    });
  }

  await removeMember(org, id);

  res.status(200).json({
    status: 200,
  });
}

export async function postInviteResend(
  req: AuthRequest<{ key: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { key } = req.body;

  let emailSent = false;
  try {
    await sendInviteEmail(org, key);
    emailSent = true;
  } catch (e) {
    req.log.error(e, "Error sending email");
    emailSent = false;
  }

  const inviteUrl = getInviteUrl(key);
  return res.status(200).json({
    status: 200,
    inviteUrl,
    emailSent,
  });
}

export async function deleteInvite(
  req: AuthRequest<{ key: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { key } = req.body;

  await revokeInvite(org, key);

  res.status(200).json({
    status: 200,
  });
}

export async function signup(
  req: AuthRequest<CreateOrganizationPostBody>,
  res: Response,
) {
  // Note: Request will not have an organization at this point. Do not use getContextFromReq
  const { company, externalId, demographicData } = req.body;

  const orgs = await hasOrganization();
  // Only allow one organization per site unless IS_MULTI_ORG is true
  if (!IS_MULTI_ORG && orgs) {
    throw new Error("An organization already exists");
  }

  let verifiedDomain = "";
  if (IS_MULTI_ORG) {
    if (orgs && !ALLOW_SELF_ORG_CREATION && !req.superAdmin) {
      throw new Error(
        "You are not allowed to create an organization.  Ask your site admin.",
      );
    }
    // if the owner is verified, try to infer a verified domain
    if (req.email && req.verified) {
      const domain = req.email.toLowerCase().split("@")[1] || "";
      const isFreeDomain = freeEmailDomains.includes(domain);
      if (!isFreeDomain) {
        verifiedDomain = domain;
      }
    }
  }

  try {
    if (company.length < 3) {
      throw Error("Company length must be at least 3 characters");
    }
    if (!req.userId) {
      throw Error("Must be logged in");
    }
    const org = await createOrganization({
      email: req.email,
      userId: req.userId,
      name: company,
      verifiedDomain,
      externalId,
      demographicData,
    });

    req.organization = org;
    const context = getContextFromReq(req);

    const project = await context.models.projects.create({
      name: "My First Project",
    });

    // Alert the site manager about new organizations that are created
    try {
      await sendNewOrgEmail(company, req.email);
    } catch (e) {
      req.log.error(e, "New org email sending failure");
    }

    // Include project id in response
    res.status(200).json({
      status: 200,
      orgId: org.id,
      projectId: project.id,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function putOrganization(
  req: AuthRequest<Partial<OrganizationInterface>>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    name,
    installationName,
    ownerEmail,
    settings,
    connections,
    externalId,
    licenseKey,
  } = req.body;

  if (connections || name || ownerEmail || installationName) {
    if (!context.permissions.canManageOrgSettings()) {
      context.permissions.throwPermissionError();
    }
  }
  if (settings) {
    Object.keys(settings).forEach((k: keyof OrganizationSettings) => {
      if (k === "environments") {
        throw new Error(
          "Not supported: Updating organization environments not supported via this route.",
        );
      } else if (k === "sdkInstructionsViewed" || k === "visualEditorEnabled") {
        if (
          !context.permissions.canCreateSDKConnection({
            projects: [],
            environment: "",
          })
        ) {
          context.permissions.throwPermissionError();
        }
      } else if (k === "attributeSchema") {
        throw new Error(
          "Not supported: Updating organization attributes not supported via this route.",
        );
      } else if (k === "northStar") {
        if (!context.permissions.canManageNorthStarMetric()) {
          context.permissions.throwPermissionError();
        }
      } else if (k === "namespaces") {
        throw new Error(
          "Not supported: Updating namespaces not supported via this route.",
        );
      } else {
        if (!context.permissions.canManageOrgSettings()) {
          context.permissions.throwPermissionError();
        }
      }
    });
  }

  try {
    const updates: Partial<OrganizationInterface> = {};

    const orig: Partial<OrganizationInterface> = {};

    if (name) {
      updates.name = name;
      orig.name = org.name;
    }
    if (installationName && !IS_CLOUD) {
      const installation = await getInstallation();
      const currentName = installation.name;
      if (installationName && currentName !== installationName) {
        await req.audit({
          event: "installation.update",
          entity: {
            object: "installation",
            id: installation.id,
          },
          details: auditDetailsUpdate(
            { name: currentName },
            { name: installationName },
          ),
        });

        await setInstallationName(installationName);
      }
    }
    if (ownerEmail && ownerEmail !== org.ownerEmail) {
      // the owner email is being changed
      const newOwnerUser = await getUserByEmail(ownerEmail);
      if (!newOwnerUser) {
        throw Error("New owner does not have an account");
      }
      updates.ownerEmail = ownerEmail;
      orig.ownerEmail = org.ownerEmail;
      // send email to original owner and new owner alerting them of the change:
      try {
        await sendOwnerEmailChangeEmail(
          req.email,
          org.name,
          org.ownerEmail,
          ownerEmail,
        );
      } catch (e) {
        req.log.error(e, "Failed to send owner email change email");
      }
    }
    if (externalId !== undefined) {
      updates.externalId = externalId;
      orig.externalId = org.externalId;
    }
    if (settings) {
      updates.settings = {
        ...org.settings,
        ...settings,
      };
      orig.settings = org.settings;
    }

    if (licenseKey && licenseKey.trim() !== org.licenseKey) {
      updates.licenseKey = licenseKey.trim();
      orig.licenseKey = org.licenseKey;
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

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export const autoAddGroupsAttribute = async (
  req: AuthRequest<never>,
  res: Response<{ status: 200; added: boolean }>,
) => {
  // Add missing `$groups` attribute automatically if it's being referenced by a Saved Group
  const context = getContextFromReq(req);
  const { org } = context;

  // TODO: When we add project-scoping to saved groups - pass in the actual projects array below
  if (!context.permissions.canCreateAttribute({})) {
    context.permissions.throwPermissionError();
  }

  let added = false;

  const attributeSchema = org.settings?.attributeSchema;
  if (
    attributeSchema &&
    !attributeSchema.some((attribute) => attribute.property === "$groups")
  ) {
    const newAttributeSchema: SDKAttribute[] = [
      ...attributeSchema,
      {
        property: "$groups",
        datatype: "string[]",
      },
    ];

    const orig = {
      settings: {
        ...org.settings,
      },
    };

    const updates = {
      settings: {
        ...org.settings,
        attributeSchema: newAttributeSchema,
      },
    };

    added = true;

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(orig, updates),
    });
  }

  return res.status(200).json({
    status: 200,
    added,
  });
};

export async function getApiKeys(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const keys = await getAllApiKeysByOrganization(context);
  const filteredKeys = keys.filter((k) => !k.userId || k.userId === req.userId);

  res.status(200).json({
    status: 200,
    keys: filteredKeys,
  });
}

export async function postApiKey(
  req: AuthRequest<{
    description?: string;
    type: string;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { description = "", type } = req.body;

  // Handle user personal access tokens
  if (type === "user") {
    if (!userId) {
      throw new Error(
        "Cannot create user personal access token without a user ID",
      );
    }
    const key = await createUserPersonalAccessApiKey({
      description,
      userId: userId,
      organizationId: org.id,
    });

    return res.status(200).json({
      status: 200,
      key,
    });
  }
  // Handle organization secret tokens
  else {
    if (!context.permissions.canCreateApiKey()) {
      context.permissions.throwPermissionError();
    }

    if (type && !["readonly", "admin"].includes(type)) {
      throw new Error("can only assign readonly or admin roles");
    }

    const key = await createOrganizationApiKey({
      organizationId: org.id,
      description,
      role: type as "readonly" | "admin",
    });

    return res.status(200).json({
      status: 200,
      key,
    });
  }
}

export async function deleteApiKey(
  req: AuthRequest<{ key?: string; id?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { userId, org } = context;
  // Old API keys did not have an id, so we need to delete by the key value itself
  const { key, id } = req.body;
  if (!key && !id) {
    throw new Error("Must provide either an API key or id in order to delete");
  }

  const keyObj = await getApiKeyByIdOrKey(
    context,
    id || undefined,
    key || undefined,
  );
  if (!keyObj) {
    throw new Error("Could not find API key to delete");
  }

  if (keyObj.secret) {
    if (!keyObj.userId) {
      // If there is no userId, this is an API Key, so we check permissions.
      if (!context.permissions.canDeleteApiKey()) {
        context.permissions.throwPermissionError();
      }
      // Otherwise, this is a Personal Access Token (PAT) - users can delete only their own PATs regardless of permission level.
    } else if (keyObj.userId !== userId) {
      throw new Error("You do not have permission to delete this.");
    }
  } else {
    if (
      !context.permissions.canDeleteSDKConnection({
        projects: [keyObj.project || ""],
        environment: keyObj.environment || "",
      })
    ) {
      context.permissions.throwPermissionError();
    }
  }

  if (id) {
    await deleteApiKeyById(org.id, id);
  } else if (key) {
    await deleteApiKeyByKey(org.id, key);
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postApiKeyReveal(
  req: AuthRequest<{ id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.body;

  const key = await getUnredactedSecretKey(org.id, id);
  if (!key) {
    return res.status(403).json({
      status: 403,
    });
  }

  if (!key.userId) {
    // Only admins can reveal non-user keys
    if (!context.permissions.canCreateApiKey()) {
      context.permissions.throwPermissionError();
    }
  } else {
    // This is a user key
    // The key must be owned by the user requesting to reveal it
    const isMatchingUserKey = req.userId === key.userId;
    if (!isMatchingUserKey) {
      return res.status(403).json({
        status: 403,
      });
    }
  }

  res.status(200).json({
    status: 200,
    key,
  });
}

export async function getLegacyWebhooks(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const webhooks = await context.models.sdkWebhooks.findAllLegacySdkWebhooks();

  res.status(200).json({
    status: 200,
    webhooks: webhooks.filter((webhook) =>
      context.permissions.canReadSingleProjectResource(webhook.project),
    ),
  });
}

export async function testSDKWebhook(
  req: AuthRequest<Record<string, unknown>, { id: string }>,
  res: Response,
) {
  const webhookId = req.params.id;

  const context = getContextFromReq(req);
  const webhook = await context.models.sdkWebhooks.getById(webhookId);
  if (!webhook) {
    throw new Error("Could not find webhook");
  }

  const conns = await findSDKConnectionsByIds(context, webhook.sdks);
  if (!conns.length) {
    throw new Error("Could not find any SDK connection tied to this webhook");
  }

  if (!conns.every((c) => context.permissions.canUpdateSDKWebhook(c))) {
    context.permissions.throwPermissionError();
  }

  await fireSdkWebhook(context, webhook).catch(() => {
    // Do nothing, already being logged in Mongo
  });
  res.status(200).json({
    status: 200,
  });
}

export async function putSDKWebhook(
  req: AuthRequest<UpdateSdkWebhookProps, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const { id } = req.params;
  const webhook = await context.models.sdkWebhooks.getById(id);
  if (!webhook) {
    throw new Error("Could not find webhook");
  }

  const conns = await findSDKConnectionsByIds(context, webhook.sdks);
  if (!conns.length) {
    throw new Error("Could not find any SDK connection tied to this webhook");
  }

  if (!conns.every((c) => context.permissions.canUpdateSDKWebhook(c))) {
    context.permissions.throwPermissionError();
  }

  const updatedWebhook = await context.models.sdkWebhooks.update(
    webhook,
    updateSdkWebhookValidator.parse(req.body),
  );

  // Fire the webhook now that it has changed
  fireSdkWebhook(context, updatedWebhook).catch(() => {
    // Do nothing, already being logged in Mongo
  });
  res.status(200).json({
    status: 200,
    webhook: updatedWebhook,
  });
}

export async function deleteLegacyWebhook(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageLegacySDKWebhooks()) {
    context.permissions.throwPermissionError();
  }
  const { id } = req.params;
  await context.models.sdkWebhooks.deleteLegacySdkWebhookById(id);

  res.status(200).json({
    status: 200,
  });
}

export async function deleteSDKWebhook(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const webhook = await context.models.sdkWebhooks.getById(id);
  if (webhook) {
    // It's ok if conns is empty here
    // We still want to allow deleting orphaned webhooks
    const conns = await findSDKConnectionsByIds(context, webhook.sdks);
    if (!conns.every((c) => context.permissions.canDeleteSDKWebhook(c))) {
      context.permissions.throwPermissionError();
    }
  }

  await context.models.sdkWebhooks.deleteById(id);

  res.status(200).json({
    status: 200,
  });
}

export async function postImportConfig(
  req: AuthRequest<{
    contents: string;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const { contents } = req.body;

  const config: ConfigFile = JSON.parse(contents);
  if (!config) {
    throw new Error("Failed to parse config.yml file contents.");
  }

  await importConfig(context, config);

  res.status(200).json({
    status: 200,
  });
}

export async function getOrphanedUsers(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  if (IS_CLOUD) {
    throw new Error("Unable to get orphaned users on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins get orphaned users on multi-org deployments",
    );
  }

  const allUsers = await getAllUsers();
  const { organizations: allOrgs } = await findAllOrganizations(1, "");

  const membersInOrgs = new Set<string>();
  allOrgs.forEach((org) => {
    org.members.forEach((m) => {
      membersInOrgs.add(m.id);
    });
  });

  const orphanedUsers = allUsers
    .filter((u) => !membersInOrgs.has(u.id))
    .map(({ id, name, email }) => ({
      id,
      name,
      email,
    }));

  return res.status(200).json({
    status: 200,
    orphanedUsers,
  });
}

export async function addOrphanedUser(
  req: AuthRequest<MemberRoleWithProjects, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  if (IS_CLOUD) {
    throw new Error("This action is not permitted on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins can add orphaned users on multi-org deployments",
    );
  }

  const { org } = getContextFromReq(req);

  const { id } = req.params;
  const { role, environments, limitAccessByEnvironment, projectRoles } =
    req.body;

  // Make sure user exists
  const user = await getUserById(id);
  if (!user) {
    return res.status(400).json({
      status: 400,
      message: "Cannot find user with that id",
    });
  }

  // Make sure user is actually orphaned
  const orgs = await findOrganizationsByMemberId(id);
  if (orgs.length) {
    return res.status(400).json({
      status: 400,
      message: "Cannot add users who are already part of an organization",
    });
  }

  // Make sure role is valid
  if (!isRoleValid(role, org) || !areProjectRolesValid(projectRoles, org)) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  const license = getLicense();
  if (
    license &&
    license.hardCap &&
    getNumberOfUniqueMembersAndInvites(org) >= (license.seats || 0)
  ) {
    throw new Error(
      "Whoops! You've reached the seat limit on your license. Please contact sales@growthbook.io to increase your seat limit.",
    );
  }

  await addMemberToOrg({
    organization: org,
    userId: id,
    role,
    environments,
    limitAccessByEnvironment,
    projectRoles,
  });

  return res.status(200).json({
    status: 200,
  });
}

export async function deleteOrphanedUser(
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  if (IS_CLOUD) {
    throw new Error("Unable to delete orphaned users on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins delete orphaned users on multi-org deployments",
    );
  }

  const { id } = req.params;

  // Make sure user exists
  const user = await getUserById(id);
  if (!user) {
    return res.status(400).json({
      status: 400,
      message: "Cannot find user with that id",
    });
  }

  // Make sure user is orphaned
  const orgs = await findOrganizationsByMemberId(id);
  if (orgs.length) {
    return res.status(400).json({
      status: 400,
      message: "Cannot delete users who are part of an organization",
    });
  }

  await deleteUser(id);
  return res.status(200).json({
    status: 200,
  });
}

export async function putAdminResetUserPassword(
  req: AuthRequest<
    {
      userToUpdateId: string;
      updatedPassword: string;
    },
    {
      id: string;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const { updatedPassword } = req.body;
  const userToUpdateId = req.params.id;

  // Only enable for self-hosted deployments that are not using SSO
  if (usingOpenId()) {
    throw new Error("This functionality is not available when using SSO");
  }

  const { org } = getContextFromReq(req);
  const isUserToUpdateInSameOrg = org.members.find(
    (member) => member.id === userToUpdateId,
  );

  // Only update the password if the member we're updating is in the same org as the requester
  // Exception: allow updating the password if the user is not part of any organization
  if (!isUserToUpdateInSameOrg) {
    const orgs = await findOrganizationsByMemberId(userToUpdateId);
    if (orgs.length > 0) {
      throw new Error(
        "Cannot change password of users outside your organization.",
      );
    }
  }

  await updatePassword(userToUpdateId, updatedPassword);

  res.status(200).json({
    status: 200,
  });
}

export async function setLicenseKey(
  org: OrganizationInterface,
  licenseKey: string,
) {
  if (!IS_CLOUD && IS_MULTI_ORG) {
    throw new Error(
      "You must use the LICENSE_KEY environmental variable on multi org sites.",
    );
  }

  org.licenseKey = licenseKey;
  await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);
}

export async function putLicenseKey(
  req: AuthRequest<{ licenseKey: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const { org } = context;
  const orgId = org?.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const licenseKey = req.body.licenseKey.trim();
  if (!licenseKey) {
    throw new Error("missing license key");
  }

  await setLicenseKey(org, licenseKey);

  try {
    await updateOrganization(orgId, {
      licenseKey,
    });
  } catch (e) {
    throw new Error("Failed to save license key");
  }

  res.status(200).json({
    status: 200,
  });
}

export async function putDefaultRole(
  req: AuthRequest<{ defaultRole: MemberRoleWithProjects }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { defaultRole } = req.body;

  const commercialFeatures = [...accountFeatures[getAccountPlan(org)]];

  if (!commercialFeatures.includes("sso")) {
    throw new Error(
      "Must have a commercial License Key to update the organization's default role.",
    );
  }

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const { memberIsValid, reason } = validateRoleAndEnvs(
    org,
    defaultRole.role,
    defaultRole.limitAccessByEnvironment,
    defaultRole.environments,
  );

  if (!memberIsValid) {
    throw new Error(reason);
  }

  if (defaultRole.projectRoles?.length) {
    defaultRole.projectRoles.forEach((p) => {
      const { memberIsValid, reason } = validateRoleAndEnvs(
        org,
        p.role,
        p.limitAccessByEnvironment,
        p.environments,
      );

      if (!memberIsValid) {
        throw new Error(reason);
      }
    });
  }

  updateOrganization(org.id, {
    settings: {
      ...org.settings,
      defaultRole,
    },
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putGetStartedChecklistItem(
  req: AuthRequest<{
    checklistItem: string;
    project: string;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { checklistItem, project } = req.body;

  if (checklistItem !== "environments" && checklistItem !== "attributes") {
    throw new Error("Unexpected Get Started checklist item.");
  }

  if (
    checklistItem === "environments" &&
    !context.permissions.canCreateEnvironment({
      id: "",
      projects: [project],
    })
  ) {
    context.permissions.throwPermissionError();
  }

  if (
    checklistItem === "attributes" &&
    !context.permissions.canCreateAttribute({
      projects: [project],
    })
  ) {
    context.permissions.throwPermissionError();
  }

  addGetStartedChecklistItem(org.id, checklistItem);

  res.status(200).json({
    status: 200,
  });
}

export async function putSetupEventTracker(
  req: AuthRequest<{
    eventTracker: string;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { eventTracker } = req.body;

  try {
    await updateOrganization(org.id, {
      setupEventTracker: eventTracker,
    });
  } catch (e) {
    throw new Error("Failed to save setup event tracker");
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postCustomRole(req: AuthRequest<Role>, res: Response) {
  const context = getContextFromReq(req);
  const roleToAdd = req.body;

  if (!context.hasPremiumFeature("custom-roles")) {
    throw new Error("Must have an Enterprise License Key to use custom roles.");
  }

  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }

  await addCustomRole(context.org, roleToAdd);

  res.status(200).json({
    status: 200,
  });
}

export async function putCustomRole(
  req: AuthRequest<Omit<Role, "id">, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const roleToUpdate = req.body;
  const { id } = req.params;

  if (!context.hasPremiumFeature("custom-roles")) {
    throw new Error("Must have an Enterprise License Key to use custom roles.");
  }

  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }

  await editCustomRole(context.org, id, roleToUpdate);

  res.status(200).json({
    status: 200,
  });
}

export async function deleteCustomRole(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  if (!context.hasPremiumFeature("custom-roles")) {
    throw new Error("Must have an Enterprise License Key to use custom roles.");
  }

  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }

  await removeCustomRole(context.org, context.teams, id);

  res.status(200).json({
    status: 200,
  });
}

export async function deactivateRole(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  // Only orgs with custom-roles feature can deactivate roles
  if (!context.hasPremiumFeature("custom-roles")) {
    throw new Error("Must have an Enterprise License Key to use custom roles.");
  }

  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }

  await deactivateRoleById(context.org, id);

  res.status(200).json({
    status: 200,
  });
}

export async function activateRole(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  // Only orgs with custom-roles feature can activate roles
  if (!context.hasPremiumFeature("custom-roles")) {
    throw new Error("Must have an Enterprise License Key to use custom roles.");
  }

  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }

  await activateRoleById(context.org, id);

  res.status(200).json({
    status: 200,
  });
}

export async function postAgreeToAgreement(
  req: AuthRequest<{ agreement: AgreementType; version: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const { agreement, version } = req.body;
  try {
    const existing =
      await context.models.agreements.getAgreementForOrg(agreement);
    if (existing) {
      // hard to get into this state, but if the user/org has already agreed to this agreement, we can just return success
      return res.status(200).json({ status: 200 });
    }
    // there is no existing agreement, so we create a new one
    await context.models.agreements.create({
      agreement,
      version,
      userId: context.userId,
      userName: context.userName,
      userEmail: context.email,
      dateSigned: new Date(),
    });
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(500).json({ status: 500, message: e.message });
  }
}

export async function getFeatureExpUsage(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const hasFeatures = await hasNonDemoFeature(context);
  const hasExperiments = await hasNonDemoExperiment(context);

  return res.status(200).json({
    status: 200,
    hasFeatures,
    hasExperiments,
  });
}
