import { Response } from "express";
import { cloneDeep } from "lodash";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "../../types/AuthRequest";
import {
  acceptInvite,
  addMemberToOrg,
  getInviteUrl,
  getOrgFromReq,
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
import { getUsersByIds, updatePassword } from "../../services/users";
import { getAllTags } from "../../models/TagModel";
import {
  ExpandedMember,
  Invite,
  MemberRole,
  MemberRoleWithProjects,
  NamespaceUsage,
  OrganizationInterface,
  OrganizationSettings,
} from "../../../types/organization";
import {
  auditDetailsUpdate,
  findAllByEntityType,
  findAllByEntityTypeParent,
  findByEntity,
  findByEntityParent,
  getWatchedAudits,
} from "../../services/audit";
import { ExperimentModel } from "../../models/ExperimentModel";
import { getAllFeatures } from "../../models/FeatureModel";
import { SegmentModel } from "../../models/SegmentModel";
import { findDimensionsByOrganization } from "../../models/DimensionModel";
import { IS_CLOUD } from "../../util/secrets";
import { sendInviteEmail, sendNewOrgEmail } from "../../services/email";
import { getDataSourcesByOrganization } from "../../models/DataSourceModel";
import { getAllGroups } from "../../services/group";
import { getAllSavedGroups } from "../../models/SavedGroupModel";
import { getMetricsByOrganization } from "../../models/MetricModel";
import { WebhookModel } from "../../models/WebhookModel";
import { createWebhook } from "../../services/webhooks";
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
import { WebhookInterface } from "../../../types/webhook";
import { ExperimentRule, NamespaceValue } from "../../../types/feature";
import { usingOpenId } from "../../services/auth";
import { getSSOConnectionSummary } from "../../models/SSOConnectionModel";
import {
  createApiKey,
  deleteApiKeyById,
  deleteApiKeyByKey,
  getAllApiKeysByOrganization,
  getApiKeyByIdOrKey,
  getFirstPublishableApiKey,
  getUnredactedSecretKey,
} from "../../models/ApiKeyModel";
import {
  accountFeatures,
  getAccountPlan,
  getRoles,
} from "../../util/organization.util";
import { deleteUser, findUserById, getAllUsers } from "../../models/UserModel";
import licenseInit, { getLicense, setLicense } from "../../init/license";
import { removeEnvironmentFromSlackIntegration } from "../../models/SlackIntegrationModel";

export async function getDefinitions(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const orgId = org?.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }

  const [
    metrics,
    datasources,
    dimensions,
    segments,
    tags,
    groups,
    savedGroups,
    projects,
  ] = await Promise.all([
    getMetricsByOrganization(orgId),
    getDataSourcesByOrganization(orgId),
    findDimensionsByOrganization(orgId),
    SegmentModel.find({
      organization: orgId,
    }),
    getAllTags(orgId),
    getAllGroups(orgId),
    getAllSavedGroups(orgId),
    findAllProjectsByOrganization(orgId),
  ]);

  return res.status(200).json({
    status: 200,
    metrics,
    datasources: datasources.map((d) => {
      const integration = getSourceIntegrationObject(d);
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
    groups,
    savedGroups,
    projects,
  });
}

export async function getActivityFeed(req: AuthRequest, res: Response) {
  const { org, userId } = getOrgFromReq(req);
  try {
    const docs = await getWatchedAudits(userId, org.id);

    if (!docs.length) {
      return res.status(200).json({
        status: 200,
        events: [],
        experiments: [],
        features: [],
      });
    }

    const experimentIds = Array.from(new Set(docs.map((d) => d.entity.id)));
    const experiments = await ExperimentModel.find(
      {
        id: {
          $in: experimentIds,
        },
      },
      {
        _id: false,
        id: true,
        name: true,
      }
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
  const { org } = getOrgFromReq(req);
  const { type } = req.params;

  const events = await Promise.all([
    findAllByEntityType(org.id, type),
    findAllByEntityTypeParent(org.id, type),
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
  const { org } = getOrgFromReq(req);
  const { type, id } = req.params;

  const events = await Promise.all([
    findByEntity(org.id, type, id),
    findByEntityParent(org.id, type, id),
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

  const { org, userId } = getOrgFromReq(req);
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
      message: e.message || "Failed to change role",
    });
  }
}

export async function putInviteRole(
  req: AuthRequest<MemberRoleWithProjects, { key: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
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
  } = org;

  if (!IS_CLOUD && licenseKey) {
    // automatically set the license data based on org license key
    const licenseData = getLicense();
    if (!licenseData || (licenseData.org && licenseData.org !== id)) {
      try {
        await licenseInit(licenseKey);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("setting license failed", e);
      }
    }
  }

  // Some other global org data needed by the front-end
  const apiKeys = await getAllApiKeysByOrganization(org.id);
  const enterpriseSSO = isEnterpriseSSO(req.loginMethod)
    ? getSSOConnectionSummary(req.loginMethod)
    : null;

  // Add email/name to the organization members array
  const userInfo = await getUsersByIds(members.map((m) => m.id));
  const expandedMembers: ExpandedMember[] = [];
  userInfo.forEach(({ id, email, name, _id }) => {
    const memberInfo = members.find((m) => m.id === id);
    if (!memberInfo) return;
    expandedMembers.push({
      email,
      name,
      ...memberInfo,
      dateCreated: memberInfo.dateCreated || _id.getTimestamp(),
    });
  });

  return res.status(200).json({
    status: 200,
    apiKeys,
    enterpriseSSO,
    accountPlan: getAccountPlan(org),
    commercialFeatures: [...accountFeatures[getAccountPlan(org)]],
    roles: getRoles(org),
    members: expandedMembers,
    organization: {
      invites,
      ownerEmail,
      name,
      id,
      url,
      subscription,
      licenseKey,
      freeSeats,
      disableSelfServeBilling,
      discountCode: org.discountCode || "",
      slackTeam: connections?.slack?.team,
      settings,
      members: org.members,
    },
  });
}

export async function getNamespaces(req: AuthRequest, res: Response) {
  if (!req.organization) {
    return res.status(200).json({
      status: 200,
      organization: null,
    });
  }
  const { org } = getOrgFromReq(req);

  const namespaces: NamespaceUsage = {};

  // Get all of the active experiments that are tied to a namespace
  const allFeatures = await getAllFeatures(org.id);
  allFeatures.forEach((f) => {
    Object.keys(f.environmentSettings || {}).forEach((env) => {
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
            featureId: f.id,
            trackingKey: r.trackingKey || f.id,
            start: range[0],
            end: range[1],
            environment: env,
          });
        });
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
  req.checkPermissions("manageNamespaces");

  const { name, description, status } = req.body;
  const { org } = getOrgFromReq(req);

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
  req.checkPermissions("manageNamespaces");

  const { name, description, status } = req.body;
  const originalName = req.params.name;
  const { org } = getOrgFromReq(req);

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
  req.checkPermissions("manageNamespaces");

  const { org } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
  const {
    email,
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  } = req.body;

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
}

export async function deleteMember(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org, userId } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
  const { key } = req.body;

  await revokeInvite(org, key);

  res.status(200).json({
    status: 200,
  });
}

export async function signup(req: AuthRequest<SignupBody>, res: Response) {
  const { company } = req.body;

  if (!IS_CLOUD) {
    const orgs = await hasOrganization();
    // there are odd edge cases where a user can exist, but not an org,
    // so we want to allow org creation this way if there are no other orgs
    // on a local install.
    if (orgs && !req.admin) {
      throw new Error("An organization already exists");
    }
  }

  try {
    if (company.length < 3) {
      throw Error("Company length must be at least 3 characters");
    }
    if (!req.userId) {
      throw Error("Must be logged in");
    }
    const org = await createOrganization(req.email, req.userId, company, "");

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
  const { org } = getOrgFromReq(req);
  const { name, settings, connections } = req.body;

  const deletedEnvIds: string[] = [];

  if (connections || name) {
    req.checkPermissions("organizationSettings");
  }
  if (settings) {
    Object.keys(settings).forEach((k: keyof OrganizationSettings) => {
      if (k === "environments") {
        // Require permissions for any old environments that changed
        const affectedEnvs: Set<string> = new Set();
        org.settings?.environments?.forEach((env) => {
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
        const oldIds = new Set(
          org.settings?.environments?.map((env) => env.id) || []
        );
        settings[k]?.forEach((env) => {
          if (!oldIds.has(env.id)) {
            affectedEnvs.add(env.id);
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
        req.checkPermissions("manageTargetingAttributes");
      } else if (k === "northStar") {
        req.checkPermissions("manageNorthStarMetric");
      } else if (k === "namespaces") {
        req.checkPermissions("manageNamespaces");
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

export async function getApiKeys(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const keys = await getAllApiKeysByOrganization(org.id);
  res.status(200).json({
    status: 200,
    keys,
  });
}

export async function postApiKey(
  req: AuthRequest<{
    description?: string;
    environment: string;
    project: string;
    secret: boolean;
    encryptSDK: boolean;
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { description, environment, project, secret, encryptSDK } = req.body;

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
    req.checkPermissions("manageApiKeys");
  } else {
    req.checkPermissions("manageEnvironments", "", [environment]);
  }

  const key = await createApiKey({
    organization: org.id,
    description: description || "",
    environment: environment || "",
    project: project || "",
    secret: !!secret,
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
  const { org } = getOrgFromReq(req);
  // Old API keys did not have an id, so we need to delete by the key value itself
  const { key, id } = req.body;
  if (!key && !id) {
    throw new Error("Must provide either an API key or id in order to delete");
  }

  const keyObj = await getApiKeyByIdOrKey(
    org.id,
    id || undefined,
    key || undefined
  );
  if (!keyObj) {
    throw new Error("Could not find API key to delete");
  }

  if (keyObj.secret) {
    req.checkPermissions("manageApiKeys");
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
  req.checkPermissions("manageApiKeys");

  const { org } = getOrgFromReq(req);
  const { id } = req.body;

  const key = await getUnredactedSecretKey(org.id, id);

  res.status(200).json({
    status: 200,
    key,
  });
}

export async function getWebhooks(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const webhooks = await WebhookModel.find({
    organization: org.id,
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
    project: string;
    environment: string;
  }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);
  const { name, endpoint, project, environment } = req.body;

  const webhook = await createWebhook(
    org.id,
    name,
    endpoint,
    project,
    environment
  );

  res.status(200).json({
    status: 200,
    webhook,
  });
}

export async function putWebhook(
  req: AuthRequest<WebhookInterface, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
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

  const { org } = getOrgFromReq(req);
  const { contents } = req.body;

  const config: ConfigFile = JSON.parse(contents);
  if (!config) {
    throw new Error("Failed to parse config.yml file contents.");
  }

  await importConfig(config, org);

  res.status(200).json({
    status: 200,
  });
}

export async function getOrphanedUsers(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  if (IS_CLOUD) {
    throw new Error("Unable to get orphaned users on GrowthBook Cloud");
  }

  const allUsers = await getAllUsers();
  const allOrgs = await findAllOrganizations();

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

  const { org } = getOrgFromReq(req);

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

  const { org } = getOrgFromReq(req);
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

export async function putLicenseKey(
  req: AuthRequest<{ licenseKey: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const orgId = org?.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }
  req.checkPermissions("manageBilling");
  if (IS_CLOUD) {
    throw new Error("License keys are only applicable to self-hosted accounts");
  }
  const { licenseKey } = req.body;
  if (!licenseKey) {
    throw new Error("missing license key");
  }

  const currentLicenseData = getLicense();
  let licenseData = null;
  try {
    // set new license
    await licenseInit(licenseKey);
    licenseData = getLicense();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("setting new license failed", e);
  }
  if (!licenseData) {
    // setting license failed, revert to previous
    try {
      await setLicense(currentLicenseData);
    } catch (e) {
      // reverting also failed
      // eslint-disable-next-line no-console
      console.error("reverting to old license failed", e);
      await setLicense(null);
    }
    throw new Error("Invalid license key");
  }

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
