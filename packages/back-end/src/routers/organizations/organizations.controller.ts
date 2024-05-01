import { Response } from "express";
import { cloneDeep } from "lodash";
import { freeEmailDomains } from "free-email-domains-typescript";
import {
  accountFeatures,
  getAccountPlan,
  getEffectiveAccountPlan,
  getLicense,
  getLicenseError,
  orgHasPremiumFeature,
} from "enterprise";
import { hasReadAccess } from "shared/permissions";
import { experimentHasLinkedChanges } from "shared/util";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "../../types/AuthRequest";
import {
  acceptInvite,
  addMemberToOrg,
  addPendingMemberToOrg,
  expandOrgMembers,
  findVerifiedOrgForNewUser,
  getContextFromReq,
  getEnvironments,
  getInviteUrl,
  getNumberOfUniqueMembersAndInvites,
  importConfig,
  inviteUser,
  isEnterpriseSSO,
  removeMember,
  revokeInvite,
} from "../../services/organizations";
import {
  getNonSensitiveParams,
  getSourceIntegrationObject,
} from "../../services/datasource";
import { updatePassword } from "../../services/users";
import { getAllTags } from "../../models/TagModel";
import {
  Environment,
  Invite,
  MemberRole,
  MemberRoleWithProjects,
  NamespaceUsage,
  OrganizationInterface,
  OrganizationSettings,
  SDKAttribute,
} from "../../../types/organization";
import {
  auditDetailsUpdate,
  getRecentWatchedAudits,
  isValidAuditEntityType,
} from "../../services/audit";
import { getAllFeatures } from "../../models/FeatureModel";
import { findDimensionsByOrganization } from "../../models/DimensionModel";
import { findSegmentsByOrganization } from "../../models/SegmentModel";
import {
  ALLOW_SELF_ORG_CREATION,
  APP_ORIGIN,
  IS_CLOUD,
  IS_MULTI_ORG,
} from "../../util/secrets";
import {
  sendInviteEmail,
  sendNewMemberEmail,
  sendPendingMemberEmail,
  sendNewOrgEmail,
  sendPendingMemberApprovalEmail,
} from "../../services/email";
import { getDataSourcesByOrganization } from "../../models/DataSourceModel";
import { getAllSavedGroups } from "../../models/SavedGroupModel";
import { getMetricsByOrganization } from "../../models/MetricModel";
import { WebhookModel, countWebhooksByOrg } from "../../models/WebhookModel";
import { createWebhook, createSdkWebhook } from "../../services/webhooks";
import {
  createOrganization,
  findOrganizationByInviteKey,
  findAllOrganizations,
  findOrganizationsByMemberId,
  hasOrganization,
  updateOrganization,
} from "../../models/OrganizationModel";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { ConfigFile } from "../../init/config";
import { WebhookInterface, WebhookMethod } from "../../../types/webhook";
import { ExperimentRule, NamespaceValue } from "../../../types/feature";
import { usingOpenId } from "../../services/auth";
import { getSSOConnectionSummary } from "../../models/SSOConnectionModel";
import {
  createLegacySdkKey,
  createOrganizationApiKey,
  createUserPersonalAccessApiKey,
  deleteApiKeyById,
  deleteApiKeyByKey,
  getAllApiKeysByOrganization,
  getApiKeyByIdOrKey,
  getFirstPublishableApiKey,
  getUnredactedSecretKey,
} from "../../models/ApiKeyModel";
import {
  getDefaultRole,
  getRoles,
  getUserPermissions,
} from "../../util/organization.util";
import { deleteUser, findUserById, getAllUsers } from "../../models/UserModel";
import {
  getAllExperiments,
  getExperimentsForActivityFeed,
} from "../../models/ExperimentModel";
import { removeEnvironmentFromSlackIntegration } from "../../models/SlackIntegrationModel";
import {
  findAllAuditsByEntityType,
  findAllAuditsByEntityTypeParent,
  findAuditByEntity,
  findAuditByEntityParent,
} from "../../models/AuditModel";
import { EntityType } from "../../types/Audit";
import { getTeamsForOrganization } from "../../models/TeamModel";
import { getAllFactTablesForOrganization } from "../../models/FactTableModel";
import { TeamInterface } from "../../../types/team";
import { queueSingleWebhookById } from "../../jobs/sdkWebhooks";
import { initializeLicenseForOrg } from "../../services/licenseData";
import { findSDKConnectionsByOrganization } from "../../models/SdkConnectionModel";
import { triggerSingleSDKWebhookJobs } from "../../jobs/updateAllJobs";
import { SDKConnectionInterface } from "../../../types/sdk-connection";

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
    tags,
    savedGroups,
    projects,
    factTables,
    factMetrics,
  ] = await Promise.all([
    getMetricsByOrganization(context),
    getDataSourcesByOrganization(context),
    findDimensionsByOrganization(orgId),
    findSegmentsByOrganization(orgId),
    getAllTags(orgId),
    getAllSavedGroups(orgId),
    findAllProjectsByOrganization(context),
    getAllFactTablesForOrganization(context),
    context.models.factMetrics.getAll(),
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
    tags,
    savedGroups,
    projects,
    factTables,
    factMetrics,
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
      experimentIds
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
  req: AuthRequest<null, { type: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { type } = req.params;

  if (!isValidAuditEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message: `${type} is not a valid entity type. Possible entity types are: ${EntityType}`,
    });
  }

  const events = await Promise.all([
    findAllAuditsByEntityType(org.id, type),
    findAllAuditsByEntityTypeParent(org.id, type),
  ]);

  const merged = [...events[0], ...events[1]];

  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  if (merged.filter((e) => e.organization !== org.id).length > 0) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to view history",
    });
  }

  res.status(200).json({
    status: 200,
    events: merged,
  });
}

export async function getHistory(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { type, id } = req.params;

  if (!isValidAuditEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message: `${type} is not a valid entity type. Possible entity types are: ${EntityType}`,
    });
  }

  const events = await Promise.all([
    findAuditByEntity(org.id, type, id),
    findAuditByEntityParent(org.id, type, id),
  ]);

  const merged = [...events[0], ...events[1]];

  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  if (merged.filter((e) => e.organization !== org.id).length > 0) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to view history for this",
    });
  }

  res.status(200).json({
    status: 200,
    events: merged,
  });
}

export async function putMemberRole(
  req: AuthRequest<MemberRoleWithProjects, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org, userId } = getContextFromReq(req);
  const {
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  } = req.body;
  const { id } = req.params;

  if (id === userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
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

export async function putMember(
  req: AuthRequest<{
    orgId: string;
  }>,
  res: Response
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

  // ensure org matches calculated verified org
  const organization = await findVerifiedOrgForNewUser(req.email);
  if (!organization || organization.id !== orgId) {
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
      (inv) => inv.email === req.email
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
          teamUrl
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
        organization.ownerEmail
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
  res: Response
) {
  req.checkPermissions("manageTeam");
  const { org } = getContextFromReq(req);
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
      url
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
  res: Response
) {
  req.checkPermissions("manageTeam");
  const { org } = getContextFromReq(req);
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
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getContextFromReq(req);
  const {
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  } = req.body;
  const { key } = req.params;
  const originalInvites: Invite[] = cloneDeep(org.invites);

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
        { invites: org.invites }
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

export async function getOrganization(req: AuthRequest, res: Response) {
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
    name,
    id,
    url,
    subscription,
    freeSeats,
    connections,
    settings,
    disableSelfServeBilling,
    licenseKey,
    messages,
    externalId,
  } = org;

  let license;
  if (licenseKey || process.env.LICENSE_KEY) {
    // automatically set the license data based on org license key
    license = getLicense(licenseKey || process.env.LICENSE_KEY);
    if (!license || (license.organizationId && license.organizationId !== id)) {
      try {
        license = await initializeLicenseForOrg(org);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("setting license failed", e);
      }
    }
  }

  const filteredAttributes = settings?.attributeSchema?.filter((attribute) =>
    hasReadAccess(context.readAccessFilter, attribute.projects || [])
  );

  // Some other global org data needed by the front-end
  const apiKeys = await getAllApiKeysByOrganization(context);
  const enterpriseSSO = isEnterpriseSSO(req.loginMethod)
    ? getSSOConnectionSummary(req.loginMethod)
    : null;

  const expandedMembers = await expandOrgMembers(members);

  const teams = await getTeamsForOrganization(org.id);

  const teamsWithMembers: TeamInterface[] = teams.map((team) => {
    const memberIds = org.members
      .filter((member) => member.teams?.includes(team.id))
      .map((m) => m.id);
    return {
      ...team,
      members: memberIds,
    };
  });

  const currentUserPermissions = getUserPermissions(userId, org, teams || []);
  const seatsInUse = getNumberOfUniqueMembersAndInvites(org);

  return res.status(200).json({
    status: 200,
    apiKeys,
    enterpriseSSO,
    accountPlan: getAccountPlan(org),
    effectiveAccountPlan: getEffectiveAccountPlan(org),
    licenseError: getLicenseError(org),
    commercialFeatures: [...accountFeatures[getEffectiveAccountPlan(org)]],
    roles: getRoles(org),
    members: expandedMembers,
    currentUserPermissions,
    teams: teamsWithMembers,
    license,
    organization: {
      invites,
      ownerEmail,
      externalId,
      name,
      id,
      url,
      subscription,
      licenseKey,
      freeSeats,
      disableSelfServeBilling,
      freeTrialDate: org.freeTrialDate,
      discountCode: org.discountCode || "",
      slackTeam: connections?.slack?.team,
      settings: { ...settings, attributeSchema: filteredAttributes },
      autoApproveMembers: org.autoApproveMembers,
      members: org.members,
      messages: messages || [],
      pendingMembers: org.pendingMembers,
    },
    seatsInUse,
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
            r.namespace.enabled
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
    name: string;
    description: string;
    status: "active" | "inactive";
  }>,
  res: Response
) {
  const { name, description, status } = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateNamespace()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  const namespaces = org.settings?.namespaces || [];

  // Namespace with the same name already exists
  if (namespaces.filter((n) => n.name === name).length > 0) {
    throw new Error("Namespace names must be unique.");
  }

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: [...namespaces, { name, description, status }],
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
      }
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putNamespaces(
  req: AuthRequest<
    {
      name: string;
      description: string;
      status: "active" | "inactive";
    },
    { name: string }
  >,
  res: Response
) {
  const { name, description, status } = req.body;
  const originalName = req.params.name;
  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateNamespace()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  const namespaces = org.settings?.namespaces || [];

  // Namespace with the same name already exists
  if (namespaces.filter((n) => n.name === originalName).length === 0) {
    throw new Error("Namespace not found.");
  }
  const updatedNamespaces = namespaces.map((n) => {
    if (n.name === originalName) {
      return { name, description, status };
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
      { settings: { namespaces: updatedNamespaces } }
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function deleteNamespace(
  req: AuthRequest<null, { name: string }>,
  res: Response
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
      { settings: { namespaces: updatedNamespaces } }
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function getInviteInfo(
  req: AuthRequest<unknown, { key: string }>,
  res: ResponseWithStatusAndError<{ organization: string; role: MemberRole }>
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
  res: Response
) {
  const { key } = req.body;

  try {
    if (!req.userId) {
      throw new Error("Must be logged in");
    }
    const org = await acceptInvite(key, req.userId);

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
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getContextFromReq(req);
  const {
    email,
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  } = req.body;

  const license = getLicense();
  if (
    license &&
    license.hardCap &&
    getNumberOfUniqueMembersAndInvites(org) >= (license.seats || 0)
  ) {
    throw new Error(
      "Whoops! You've reached the seat limit on your license. Please contact sales@growthbook.io to increase your seat limit."
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

interface SignupBody {
  company: string;
  externalId: string;
}

export async function deleteMember(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org, userId } = getContextFromReq(req);
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
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getContextFromReq(req);
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
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getContextFromReq(req);
  const { key } = req.body;

  await revokeInvite(org, key);

  res.status(200).json({
    status: 200,
  });
}

export async function signup(req: AuthRequest<SignupBody>, res: Response) {
  const { company, externalId } = req.body;

  const orgs = await hasOrganization();
  if (!IS_MULTI_ORG) {
    // there are odd edge cases where a user can exist, but not an org,
    // so we want to allow org creation this way if there are no other orgs
    // on a local install.
    if (orgs && !req.superAdmin) {
      throw new Error("An organization already exists");
    }
  }

  let verifiedDomain = "";
  if (IS_MULTI_ORG) {
    if (orgs && !ALLOW_SELF_ORG_CREATION && !req.superAdmin) {
      throw new Error(
        "You are not allowed to create an organization.  Ask your site admin."
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
    });

    // Alert the site manager about new organizations that are created
    try {
      await sendNewOrgEmail(company, req.email);
    } catch (e) {
      req.log.error(e, "New org email sending failure");
    }

    res.status(200).json({
      status: 200,
      orgId: org.id,
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
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { name, settings, connections, externalId, licenseKey } = req.body;

  const deletedEnvIds: string[] = [];
  const envsWithModifiedProjects: Environment[] = [];
  const existingEnvironments = getEnvironments(org);

  if (connections || name) {
    req.checkPermissions("organizationSettings");
  }
  if (settings) {
    Object.keys(settings).forEach((k: keyof OrganizationSettings) => {
      if (k === "environments") {
        // Require permissions for any old environments that changed
        const affectedEnvs: Set<string> = new Set();
        existingEnvironments.forEach((env) => {
          const oldHash = JSON.stringify(env);
          const newHash = JSON.stringify(
            settings[k]?.find((e) => e.id === env.id)
          );
          if (oldHash !== newHash) {
            affectedEnvs.add(env.id);
          }
          if (!newHash && oldHash) {
            deletedEnvIds.push(env.id);
          }
        });

        // Require permissions for any new environments that have been added
        const oldIds = new Set(existingEnvironments.map((env) => env.id) || []);
        settings[k]?.forEach((env) => {
          if (!oldIds.has(env.id)) {
            affectedEnvs.add(env.id);
          }
        });

        // Check if any environments' projects have been changed (may require webhook triggers)
        existingEnvironments.forEach((env) => {
          const oldProjects = env.projects || [];
          const newProjects =
            settings[k]?.find((e) => e.id === env.id)?.projects || [];
          if (JSON.stringify(oldProjects) !== JSON.stringify(newProjects)) {
            envsWithModifiedProjects.push({
              ...env,
              projects: newProjects,
            });
          }
        });

        req.checkPermissions(
          "manageEnvironments",
          "",
          Array.from(affectedEnvs)
        );
      } else if (k === "sdkInstructionsViewed" || k === "visualEditorEnabled") {
        req.checkPermissions("manageEnvironments", "", []);
      } else if (k === "attributeSchema") {
        throw new Error(
          "Not supported: Updating organization attributes not supported via this route."
        );
      } else if (k === "northStar") {
        if (!context.permissions.canManageNorthStarMetric()) {
          context.permissions.throwPermissionError();
        }
      } else if (k === "namespaces") {
        throw new Error(
          "Not supported: Updating organization attributes not supported via this route."
        );
      } else {
        req.checkPermissions("organizationSettings");
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
    if (connections?.vercel) {
      const { token, configurationId, teamId } = connections.vercel;
      if (token && configurationId) {
        updates.connections = {
          ...updates.connections,
          vercel: { token, configurationId, teamId },
        };
        orig.connections = org.connections;
      }
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

    deletedEnvIds.forEach((envId) => {
      removeEnvironmentFromSlackIntegration({ organizationId: org.id, envId });
    });

    // Trigger SDK webhooks to reflect project changes in environments
    const affectedConnections = new Set<SDKConnectionInterface>();
    if (envsWithModifiedProjects.length) {
      const connections = await findSDKConnectionsByOrganization(context);
      for (const env of envsWithModifiedProjects) {
        const affected = connections.filter((c) => c.environment === env.id);
        affected.forEach((c) => affectedConnections.add(c));
      }
    }
    for (const connection of affectedConnections) {
      const isUsingProxy = !!(
        connection.proxy.enabled && connection.proxy.host
      );
      await triggerSingleSDKWebhookJobs(
        org.id,
        connection,
        {},
        connection.proxy,
        isUsingProxy
      );
    }

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
  res: Response<{ status: 200; added: boolean }>
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
    environment: string;
    project: string;
    type: string;
    secret: boolean;
    encryptSDK: boolean;
  }>,
  res: Response
) {
  const { org, userId } = getContextFromReq(req);
  const {
    description = "",
    environment = "",
    project = "",
    secret = false,
    encryptSDK,
    type,
  } = req.body;

  const { preferExisting } = req.query as { preferExisting?: string };
  if (preferExisting) {
    if (secret) {
      throw new Error("Cannot use 'preferExisting' for secret API keys");
    }
    const existing = await getFirstPublishableApiKey(org.id, environment);
    if (existing) {
      return res.status(200).json({
        status: 200,
        key: existing,
      });
    }
  }

  // Only require permissions if we are creating a new API key
  if (secret) {
    if (type !== "user") {
      // All access token types except `user` require the permission
      req.checkPermissions("manageApiKeys");
    }
  } else {
    req.checkPermissions("manageEnvironments", project, [environment]);
  }

  // Handle user personal access tokens
  if (type === "user") {
    if (!userId) {
      throw new Error(
        "Cannot create user personal access token without a user ID"
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
  if (secret) {
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

  // Handle legacy SDK connection
  const key = await createLegacySdkKey({
    description,
    environment,
    project,
    organizationId: org.id,
    encryptSDK,
  });

  res.status(200).json({
    status: 200,
    key,
  });
}

export async function deleteApiKey(
  req: AuthRequest<{ key?: string; id?: string }>,
  res: Response
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
    key || undefined
  );
  if (!keyObj) {
    throw new Error("Could not find API key to delete");
  }

  if (keyObj.secret) {
    if (!keyObj.userId) {
      // If there is no userId, this is an API Key, so we check permissions.
      req.checkPermissions("manageApiKeys");
      // Otherwise, this is a Personal Access Token (PAT) - users can delete only their own PATs regardless of permission level.
    } else if (keyObj.userId !== userId) {
      throw new Error("You do not have permission to delete this.");
    }
  } else {
    req.checkPermissions("manageEnvironments", "", [keyObj.environment || ""]);
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
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { id } = req.body;

  const key = await getUnredactedSecretKey(org.id, id);
  if (!key) {
    return res.status(403).json({
      status: 403,
    });
  }

  if (!key.userId) {
    // Only admins can reveal non-user keys
    req.checkPermissions("manageApiKeys");
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

export async function getWebhooks(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const webhooks = await WebhookModel.find({
    organization: context.org.id,
    useSdkMode: { $ne: true },
  });

  res.status(200).json({
    status: 200,
    webhooks: webhooks.filter((webhook) =>
      hasReadAccess(context.readAccessFilter, webhook.project)
    ),
  });
}

export async function getWebhooksSDK(
  req: AuthRequest<Record<string, unknown>, { sdkid: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { sdkid } = req.params;
  const webhooks = await WebhookModel.find({
    organization: org.id,
    useSdkMode: true,
    sdks: { $in: sdkid },
  });
  res.status(200).json({
    status: 200,
    webhooks,
  });
}

export async function postWebhook(
  req: AuthRequest<{
    name: string;
    endpoint: string;
    project?: string;
    environment: string;
  }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { name, endpoint, project, environment } = req.body;

  const webhook = await createWebhook({
    organization: org.id,
    name,
    endpoint,
    project,
    environment,
  });

  res.status(200).json({
    status: 200,
    webhook,
  });
}
export async function getTestWebhook(
  req: AuthRequest<Record<string, unknown>, { id: string }>,
  res: Response
) {
  const webhookId = req.params.id;
  await queueSingleWebhookById(webhookId);
  res.status(200).json({
    status: 200,
  });
}
export async function postWebhookSDK(
  req: AuthRequest<{
    name: string;
    endpoint: string;
    sdkid: string;
    sendPayload: boolean;
    headers?: string;
    httpMethod: WebhookMethod;
  }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { name, endpoint, sdkid, sendPayload, headers, httpMethod } = req.body;
  const webhookcount = await countWebhooksByOrg(org.id);
  const canAddMultipleSdkWebhooks = orgHasPremiumFeature(
    org,
    "multiple-sdk-webhooks"
  );
  if (!canAddMultipleSdkWebhooks && webhookcount > 0) {
    throw new Error("your webhook limit has been reached");
  }

  const webhook = await createSdkWebhook({
    organization: org.id,
    name,
    endpoint,
    sdkid,
    sendPayload,
    headers: headers || "",
    httpMethod,
  });
  return res.status(200).json({
    status: 200,
    webhook,
  });
}

export async function putWebhook(
  req: AuthRequest<WebhookInterface, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { id } = req.params;
  const webhook = await WebhookModel.findOne({
    id,
  });

  if (!webhook) {
    throw new Error("Could not find webhook");
  }
  if (webhook.organization !== org.id) {
    throw new Error("You don't have access to that webhook");
  }

  const { name, endpoint, project, environment } = req.body;
  if (!name || !endpoint) {
    throw new Error("Missing required properties");
  }

  webhook.set("name", name);
  webhook.set("endpoint", endpoint);
  webhook.set("project", project || "");
  webhook.set("environment", environment || "");
  if (webhook.useSdkMode) queueSingleWebhookById(webhook.id);
  await webhook.save();

  res.status(200).json({
    status: 200,
    webhook,
  });
}

export async function deleteWebhook(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { id } = req.params;

  await WebhookModel.deleteOne({
    organization: org.id,
    id,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function deleteWebhookSDK(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { id } = req.params;

  await WebhookModel.deleteOne({
    organization: org.id,
    id,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postImportConfig(
  req: AuthRequest<{
    contents: string;
  }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const context = getContextFromReq(req);
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
  req.checkPermissions("organizationSettings");

  if (IS_CLOUD) {
    throw new Error("Unable to get orphaned users on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins get orphaned users on multi-org deployments"
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
  res: Response
) {
  req.checkPermissions("organizationSettings");

  if (IS_CLOUD) {
    throw new Error("This action is not permitted on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins can add orphaned users on multi-org deployments"
    );
  }

  const { org } = getContextFromReq(req);

  const { id } = req.params;
  const {
    role,
    environments,
    limitAccessByEnvironment,
    projectRoles,
  } = req.body;

  // Make sure user exists
  const user = await findUserById(id);
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

  const license = getLicense();
  if (
    license &&
    license.hardCap &&
    getNumberOfUniqueMembersAndInvites(org) >= (license.seats || 0)
  ) {
    throw new Error(
      "Whoops! You've reached the seat limit on your license. Please contact sales@growthbook.io to increase your seat limit."
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
  res: Response
) {
  req.checkPermissions("organizationSettings");

  if (IS_CLOUD) {
    throw new Error("Unable to delete orphaned users on GrowthBook Cloud");
  }

  if (IS_MULTI_ORG && !req.superAdmin) {
    throw new Error(
      "Only super admins delete orphaned users on multi-org deployments"
    );
  }

  const { id } = req.params;

  // Make sure user exists
  const user = await findUserById(id);
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
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const { updatedPassword } = req.body;
  const userToUpdateId = req.params.id;

  // Only enable for self-hosted deployments that are not using SSO
  if (usingOpenId()) {
    throw new Error("This functionality is not available when using SSO");
  }

  const { org } = getContextFromReq(req);
  const isUserToUpdateInSameOrg = org.members.find(
    (member) => member.id === userToUpdateId
  );

  // Only update the password if the member we're updating is in the same org as the requester
  // Exception: allow updating the password if the user is not part of any organization
  if (!isUserToUpdateInSameOrg) {
    const orgs = await findOrganizationsByMemberId(userToUpdateId);
    if (orgs.length > 0) {
      throw new Error(
        "Cannot change password of users outside your organization."
      );
    }
  }

  await updatePassword(userToUpdateId, updatedPassword);

  res.status(200).json({
    status: 200,
  });
}

async function setLicenseKey(org: OrganizationInterface, licenseKey: string) {
  if (!IS_CLOUD && IS_MULTI_ORG) {
    throw new Error(
      "You must use the LICENSE_KEY environmental variable on multi org sites."
    );
  }

  try {
    org.licenseKey = licenseKey;
    await initializeLicenseForOrg(org, true);
  } catch (error) {
    // As we show this error on the front-end, show a more generic invalid license key error
    // if the error is not related to being able to connect to the license server
    if (error.message.includes("Could not connect")) {
      throw new Error(error?.message);
    } else {
      throw new Error("Invalid license key");
    }
  }
}

export async function putLicenseKey(
  req: AuthRequest<{ licenseKey: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const orgId = org?.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }
  req.checkPermissions("manageBilling");

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
  req: AuthRequest<{ defaultRole: MemberRole }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { defaultRole } = req.body;

  const commercialFeatures = [...accountFeatures[getAccountPlan(org)]];

  if (!commercialFeatures.includes("sso")) {
    throw new Error(
      "Must have a commercial License Key to update the organization's default role."
    );
  }

  req.checkPermissions("manageTeam");

  updateOrganization(org.id, {
    settings: {
      ...org.settings,
      defaultRole: {
        role: defaultRole,
        limitAccessByEnvironment: false,
        environments: [],
      },
    },
  });

  res.status(200).json({
    status: 200,
  });
}
