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
  addMemberToOrg,
  validateLogin,
  getPermissionsByRole,
  updateRole,
} from "../services/organizations";
import {
  getSourceIntegrationObject,
  getNonSensitiveParams,
} from "../services/datasource";
import { createUser, getUsersByIds } from "../services/users";
import { getAllTags } from "../models/TagModel";
import {
  getAllApiKeysByOrganization,
  createApiKey,
  deleteByOrganizationAndApiKey,
  getFirstApiKey,
} from "../services/apiKey";
import { UserModel } from "../models/UserModel";
import {
  MemberRole,
  NamespaceUsage,
  OrganizationInterface,
} from "../../types/organization";
import {
  getWatchedAudits,
  findByEntity,
  findByEntityParent,
} from "../services/audit";
import { WatchModel } from "../models/WatchModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { getExperimentById, ensureWatching } from "../services/experiments";
import { getFeature } from "../models/FeatureModel";
import { SegmentModel } from "../models/SegmentModel";
import { findDimensionsByOrganization } from "../models/DimensionModel";
import { IS_CLOUD } from "../util/secrets";
import {
  sendInviteEmail,
  sendNewMemberEmail,
  sendNewOrgEmail,
} from "../services/email";
import { getDataSourcesByOrganization } from "../models/DataSourceModel";
import { getAllGroups } from "../services/group";
import { uploadFile } from "../services/files";
import { getMetricsByOrganization } from "../models/MetricModel";
import { WebhookModel } from "../models/WebhookModel";
import { createWebhook } from "../services/webhooks";
import {
  createOrganization,
  findOrganizationByClaimedDomain,
  findOrganizationsByMemberId,
  hasOrganization,
  updateOrganization,
} from "../models/OrganizationModel";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { ConfigFile } from "../init/config";
import { WebhookInterface } from "../../types/webhook";
import { getAllFeatures } from "../models/FeatureModel";
import { ExperimentRule, NamespaceValue } from "../../types/feature";

export async function getUser(req: AuthRequest, res: Response) {
  // Ensure user exists in database
  if (!req.userId && IS_CLOUD) {
    const user = await createUser(req.name || "", req.email, "", req.verified);
    req.userId = user.id;
  }

  if (!req.userId) {
    throw new Error("Must be logged in");
  }

  const userId = req.userId;

  // List of all organizations the user belongs to
  const orgs = await findOrganizationsByMemberId(userId);

  // If the user is not in an organization yet and they are using GrowthBook Cloud
  // Check to see if they should be auto-added to one based on their email domain
  if (!orgs.length && IS_CLOUD) {
    const emailDomain = req.email.split("@").pop()?.toLowerCase() || "";

    const autoOrg = await findOrganizationByClaimedDomain(emailDomain);
    if (autoOrg) {
      // Throw error is the login method is invalid
      validateLogin(req, autoOrg);

      await addMemberToOrg(autoOrg, userId);
      orgs.push(autoOrg);
      try {
        await sendNewMemberEmail(
          req.name || "",
          req.email || "",
          autoOrg.name,
          autoOrg.ownerEmail
        );
      } catch (e) {
        console.error("Failed to send new member email", e.message);
      }
    }
  }

  // Filter out orgs that the user can't log in to
  let lastError: Error | null = null;
  const validOrgs = orgs.filter((org) => {
    try {
      validateLogin(req, org);
      return true;
    } catch (e) {
      lastError = e;
      return false;
    }
  });
  // If all of a user's orgs were filtered out, throw an error
  if (orgs.length && !validOrgs.length && lastError) {
    throw lastError;
  }

  return res.status(200).json({
    status: 200,
    userId: userId,
    userName: req.name,
    email: req.email,
    admin: !!req.admin,
    organizations: validOrgs.map((org) => {
      const role = getRole(org, userId);
      return {
        id: org.id,
        name: org.name,
        subscriptionStatus: org.subscription?.status,
        trialEnd: org.subscription?.trialEnd,
        role,
        permissions: getPermissionsByRole(role),
        settings: org.settings || {},
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
      };
    }),
    dimensions,
    segments,
    tags,
    groups,
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
    const docs = await getWatchedAudits(userId, org.id, {
      limit: 25,
    });

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

  await ensureWatching(userId, org.id, id, type + "s");

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
  req.checkPermissions("organizationSettings");

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

export async function getOrganization(req: AuthRequest, res: Response) {
  if (!req.organization) {
    return res.status(200).json({
      status: 200,
      organization: null,
    });
  }
  const { org } = getOrgFromReq(req);

  req.checkPermissions("organizationSettings");

  const {
    invites,
    members,
    ownerEmail,
    name,
    url,
    subscription,
    connections,
    settings,
  } = org;

  const roleMapping: Map<string, MemberRole> = new Map();
  members.forEach((m) => {
    roleMapping.set(m.id, updateRole(m.role));
  });

  const users = await getUsersByIds(members.map((m) => m.id));

  const apiKeys = await getAllApiKeysByOrganization(org.id);

  return res.status(200).json({
    status: 200,
    apiKeys,
    organization: {
      invites,
      ownerEmail,
      name,
      url,
      subscription,
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
  req: AuthRequest<{ name: string; description: string }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const { name, description } = req.body;
  const { org } = getOrgFromReq(req);

  const namespaces = org.settings?.namespaces || [];

  // Namespace with the same name already exists
  if (namespaces.filter((n) => n.name === name).length > 0) {
    throw new Error("Namespace names must be unique.");
  }

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: [...namespaces, { name, description }],
    },
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postInviteAccept(req: AuthRequest, res: Response) {
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

export async function postInvite(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

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
  req.checkPermissions("organizationSettings");

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
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { key } = req.body;

  let emailSent = false;
  try {
    await sendInviteEmail(org, key);
    emailSent = true;
  } catch (e) {
    console.error("Error sending email: " + e);
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
  req.checkPermissions("organizationSettings");

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
      console.error("New org email sending failure:", e.message);
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
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { name, settings } = req.body;

  try {
    const updates: Partial<OrganizationInterface> = {};

    if (name) {
      updates.name = name;
    }
    if (settings) {
      updates.settings = {
        ...org.settings,
        ...settings,
      };
    }

    await updateOrganization(org.id, updates);

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
  req: AuthRequest<{ description?: string; environment: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { description, environment } = req.body;

  const { preferExisting } = req.query as { preferExisting?: string };
  if (preferExisting) {
    const existing = await getFirstApiKey(org.id, environment);
    if (existing) {
      return res.status(200).json({
        status: 200,
        key: existing.key,
      });
    }
  }

  // Only require permissions if we are creating a new API key
  req.checkPermissions("organizationSettings");
  const key = await createApiKey(org.id, environment, description);

  res.status(200).json({
    status: 200,
    key,
  });
}

export async function deleteApiKey(
  req: AuthRequest<null, { key: string }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { key } = req.params;

  await deleteByOrganizationAndApiKey(org.id, key);

  res.status(200).json({
    status: 200,
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
  req.checkPermissions("organizationSettings");

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
  req.checkPermissions("organizationSettings");

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
  req.checkPermissions("organizationSettings");

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

export async function postImportConfig(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { contents }: { contents: string } = req.body;

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
