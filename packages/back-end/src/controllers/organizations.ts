import { Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  acceptInvite,
  inviteUser,
  removeMember,
  revokeInvite,
  getInviteUrl,
  getRole,
  importConfig,
  getOrgFromReq,
  getPermissionsByRole,
  updateRole,
  addMemberFromSSOConnection,
  isEnterpriseSSO,
  validateLoginMethod,
} from "../services/organizations";
import {
  getSourceIntegrationObject,
  getNonSensitiveParams,
} from "../services/datasource";
import { createUser, getUsersByIds, updatePassword } from "../services/users";
import { getAllTags } from "../models/TagModel";
import { UserModel } from "../models/UserModel";
import {
  Invite,
  MemberRole,
  NamespaceUsage,
  OrganizationInterface,
  OrganizationSettings,
  Permissions,
} from "../../types/organization";
import {
  getWatchedAudits,
  findByEntity,
  findByEntityParent,
  auditDetailsUpdate,
} from "../services/audit";
import { WatchModel } from "../models/WatchModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { getExperimentById, ensureWatching } from "../services/experiments";
import { getFeature, getAllFeatures } from "../models/FeatureModel";
import { SegmentModel } from "../models/SegmentModel";
import { findDimensionsByOrganization } from "../models/DimensionModel";
import { IS_CLOUD } from "../util/secrets";
import { sendInviteEmail, sendNewOrgEmail } from "../services/email";
import { getDataSourcesByOrganization } from "../models/DataSourceModel";
import { getAllGroups } from "../services/group";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import { uploadFile } from "../services/files";
import { getMetricsByOrganization } from "../models/MetricModel";
import { WebhookModel } from "../models/WebhookModel";
import { createWebhook } from "../services/webhooks";
import {
  createOrganization,
  findOrganizationsByMemberId,
  hasOrganization,
  updateOrganization,
} from "../models/OrganizationModel";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { ConfigFile } from "../init/config";
import { WebhookInterface } from "../../types/webhook";
import { ExperimentRule, NamespaceValue } from "../../types/feature";
import { hasActiveSubscription } from "../services/stripe";
import { usingOpenId } from "../services/auth";
import { cloneDeep } from "lodash";
import { getLicense } from "../init/license";
import { getSSOConnectionSummary } from "../models/SSOConnectionModel";
import {
  createApiKey,
  deleteApiKeyById,
  deleteApiKeyByKey,
  getAllApiKeysByOrganization,
  getApiKeyByIdOrKey,
  getFirstPublishableApiKey,
  getUnredactedSecretKey,
} from "../models/ApiKeyModel";

export async function getUser(req: AuthRequest, res: Response) {
  // If using SSO, auto-create users in Mongo who we don't recognize yet
  if (!req.userId && usingOpenId()) {
    const user = await createUser(req.name || "", req.email, "", req.verified);
    req.userId = user.id;
  }

  if (!req.userId) {
    throw new Error("Must be logged in");
  }

  const userId = req.userId;

  // List of all organizations the user belongs to
  const orgs = await findOrganizationsByMemberId(userId);

  // If the user is not in an organization yet and is using SSO
  // Check to see if they should be auto-added to one based on their email domain
  if (!orgs.length) {
    const autoOrg = await addMemberFromSSOConnection(req);
    if (autoOrg) {
      orgs.push(autoOrg);
    }
  }

  // Filter out orgs that the user can't log in to
  let lastError = "";
  const validOrgs = orgs.filter((org) => {
    try {
      validateLoginMethod(org, req);
      return true;
    } catch (e) {
      lastError = e;
      return false;
    }
  });

  // If all of a user's orgs were filtered out, throw an error
  if (orgs.length && !validOrgs.length) {
    throw new Error(lastError || "Must login with SSO");
  }

  return res.status(200).json({
    status: 200,
    userId: userId,
    userName: req.name,
    email: req.email,
    admin: !!req.admin,
    license: !IS_CLOUD && getLicense(),
    organizations: validOrgs.map((org) => {
      const role = getRole(org, userId);
      return {
        id: org.id,
        name: org.name,
        role,
        permissions: getPermissionsByRole(role),
        enterprise: org.enterprise || false,
        settings: org.settings || {},
        freeSeats: org.freeSeats || 3,
        discountCode: org.discountCode || "",
        hasActiveSubscription: hasActiveSubscription(org),
      };
    }),
  });
}

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
        type: d.type,
        settings: d.settings,
        params: getNonSensitiveParams(integration),
        properties: integration.getSourceProperties(),
        decryptionError: integration.decryptionError || false,
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

export async function getUsers(req: AuthRequest, res: Response) {
  let users: { id: string; name: string; email: string }[] = [];

  if (req.organization) {
    const members = await getUsersByIds(
      req.organization.members.map((m) => m.id)
    );
    users = members.map(({ id, name, email }) => ({
      id,
      name,
      email,
    }));
  }

  res.status(200).json({
    status: 200,
    users,
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

export async function postWatchItem(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { type, id } = req.params;
  let item;

  if (type === "feature") {
    item = await getFeature(org.id, id);
  } else if (type === "experiment") {
    item = await getExperimentById(id);
    if (item && item.organization !== org.id) {
      res.status(403).json({
        status: 403,
        message: "You do not have access to this experiment",
      });
      return;
    }
  }
  if (!item) {
    throw new Error(`Could not find ${item}`);
  }
  if (type == "feature") {
    await ensureWatching(userId, org.id, id, "features");
  } else {
    await ensureWatching(userId, org.id, id, "experiments");
  }

  return res.status(200).json({
    status: 200,
  });
}

export async function postUnwatchItem(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { type, id } = req.params;
  const pluralType = type + "s";

  try {
    await WatchModel.updateOne(
      {
        userId: userId,
        organization: org.id,
      },
      {
        $pull: {
          [pluralType]: id,
        },
      }
    );

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getWatchedItems(req: AuthRequest, res: Response) {
  const { org, userId } = getOrgFromReq(req);
  try {
    const watch = await WatchModel.findOne({
      userId: userId,
      organization: org.id,
    });
    res.status(200).json({
      status: 200,
      experiments: watch?.experiments || [],
      features: watch?.features || [],
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
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

export async function putUserName(
  req: AuthRequest<{ name: string }>,
  res: Response
) {
  const { name } = req.body;
  const { userId } = getOrgFromReq(req);

  try {
    await UserModel.updateOne(
      {
        id: userId,
      },
      {
        $set: {
          name,
        },
      }
    );
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

export async function putMemberRole(
  req: AuthRequest<{ role: MemberRole }, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org, userId } = getOrgFromReq(req);
  const { role } = req.body;
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
  req: AuthRequest<{ role: MemberRole }, { key: string }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getOrgFromReq(req);
  const { role } = req.body;
  const { key } = req.params;
  const originalInvites: Invite[] = cloneDeep(org.invites);

  let found = false;

  org.invites.forEach((m) => {
    if (m.key === key) {
      m.role = role;
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
    url,
    subscription,
    freeSeats,
    connections,
    settings,
    disableSelfServeBilling,
    enterprise,
  } = org;

  const roleMapping: Map<string, MemberRole> = new Map();
  members.forEach((m) => {
    roleMapping.set(m.id, updateRole(m.role));
  });

  const users = await getUsersByIds(members.map((m) => m.id));

  const apiKeys = await getAllApiKeysByOrganization(org.id);

  const enterpriseSSO = isEnterpriseSSO(req.loginMethod)
    ? getSSOConnectionSummary(req.loginMethod)
    : null;

  return res.status(200).json({
    status: 200,
    apiKeys,
    enterpriseSSO,
    organization: {
      invites,
      ownerEmail,
      name,
      url,
      subscription,
      freeSeats,
      enterprise,
      disableSelfServeBilling,
      slackTeam: connections?.slack?.team,
      members: users.map(({ id, email, name }) => {
        return {
          id,
          email,
          name,
          role: roleMapping.get(id),
        };
      }),
      settings,
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
  req: AuthRequest<{
    email: string;
    role: MemberRole;
  }>,
  res: Response
) {
  req.checkPermissions("manageTeam");

  const { org } = getOrgFromReq(req);
  const { email, role } = req.body;

  const { emailSent, inviteUrl } = await inviteUser(org, email, role);

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
  const requiredPermissions: Set<keyof Permissions> = new Set();

  const { org } = getOrgFromReq(req);
  const { name, settings, connections } = req.body;

  if (connections || name) {
    requiredPermissions.add("organizationSettings");
  }
  if (settings) {
    Object.keys(settings).forEach((k: keyof OrganizationSettings) => {
      if (
        k === "environments" ||
        k === "sdkInstructionsViewed" ||
        k === "visualEditorEnabled"
      ) {
        requiredPermissions.add("manageEnvironments");
      } else if (k === "attributeSchema") {
        requiredPermissions.add("manageTargetingAttributes");
      } else if (k === "northStar") {
        requiredPermissions.add("manageNorthStarMetric");
      } else if (k === "namespaces") {
        requiredPermissions.add("manageNamespaces");
      } else {
        requiredPermissions.add("organizationSettings");
      }
    });
  }
  if (requiredPermissions.size > 0) {
    req.checkPermissions(...requiredPermissions);
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
    secret: boolean;
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { description, environment, secret } = req.body;

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
    req.checkPermissions("manageEnvironments");
  }

  const key = await createApiKey({
    organization: org.id,
    description: description || "",
    environment: environment || "",
    secret: !!secret,
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
    req.checkPermissions("manageEnvironments");
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

export async function putUpload(req: Request, res: Response) {
  const { signature, path } = req.query as { signature: string; path: string };
  await uploadFile(path, signature, req.body);

  res.status(200).json({
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

  if (usingOpenId()) {
    throw new Error("This functionality is not available when using SSO");
  }

  const { org } = getOrgFromReq(req);
  const isUserToUpdateInSameOrg = org.members.find(
    (member) => member.id === userToUpdateId
  );

  // Only update the password if the member we're updating is in the same org as the requester
  if (!isUserToUpdateInSameOrg) {
    throw new Error(
      "Cannot change password of users outside your organization."
    );
  }

  await updatePassword(userToUpdateId, updatedPassword);

  res.status(200).json({
    status: 200,
  });
}
