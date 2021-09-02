import { Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  acceptInvite,
  inviteUser,
  removeMember,
  revokeInvite,
  getInviteUrl,
  getRole,
} from "../services/organizations";
import {
  DataSourceParams,
  DataSourceType,
  DataSourceSettings,
  DataSourceInterface,
} from "../../types/datasource";
import {
  testDataSourceConnection,
  mergeAndEncryptParams,
  getSourceIntegrationObject,
} from "../services/datasource";
import { createUser, getUsersByIds } from "../services/users";
import { getAllTags } from "../services/tag";
import {
  getAllApiKeysByOrganization,
  createApiKey,
  deleteByOrganizationAndApiKey,
} from "../services/apiKey";
import { getOauth2Client } from "../integrations/GoogleAnalytics";
import { UserModel } from "../models/UserModel";
import { MemberRole, OrganizationInterface } from "../../types/organization";
import {
  getWatchedAudits,
  findByEntity,
  findByEntityParent,
} from "../services/audit";
import { WatchModel } from "../models/WatchModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { QueryModel } from "../models/QueryModel";
import { createManualSnapshot } from "../services/experiments";
import { SegmentModel } from "../models/SegmentModel";
import {
  findDimensionsByDataSource,
  findDimensionsByOrganization,
} from "../models/DimensionModel";
import { IS_CLOUD } from "../util/secrets";
import { sendInviteEmail, sendNewOrgEmail } from "../services/email";
import {
  createDataSource,
  getDataSourcesByOrganization,
  getDataSourceById,
  deleteDatasourceById,
  updateDataSource,
} from "../models/DataSourceModel";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { getAllGroups } from "../services/group";
import { uploadFile } from "../services/files";
import { ExperimentInterface } from "../../types/experiment";
import {
  insertMetric,
  getMetricsByDatasource,
  getMetricsByOrganization,
  hasSampleMetric,
} from "../models/MetricModel";
import { MetricInterface } from "../../types/metric";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import uniqid from "uniqid";
import { WebhookModel } from "../models/WebhookModel";
import { createWebhook } from "../services/webhooks";
import {
  createOrganization,
  findOrganizationsByMemberId,
  updateOrganization,
} from "../models/OrganizationModel";

export async function getUser(req: AuthRequest, res: Response) {
  // Ensure user exists in database
  if (!req.userId) {
    if (IS_CLOUD) {
      const user = await createUser(req.name, req.email);
      req.userId = user.id;
    } else {
      throw new Error("Must be logged in");
    }
  }

  // List of all organizations the user belongs to
  const orgs = await findOrganizationsByMemberId(req.userId);

  return res.status(200).json({
    status: 200,
    userId: req.userId,
    userName: req.name,
    email: req.email,
    admin: !!req.admin,
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      subscriptionStatus: org.subscription?.status,
      trialEnd: org.subscription?.trialEnd,
      role: getRole(org, req.userId),
      settings: org.settings || {},
    })),
  });
}

export async function postSampleData(req: AuthRequest, res: Response) {
  const orgId = req.organization?.id;
  if (!orgId) {
    throw new Error("Must be part of an organization");
  }

  const existingMetric = await hasSampleMetric(orgId);
  if (existingMetric) {
    throw new Error("Sample data already exists");
  }

  const metric1: Partial<MetricInterface> = {
    id: uniqid("met_sample_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Sample Conversions",
    description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
    type: "binomial",
    organization: orgId,
    userIdType: "anonymous",
  };
  await insertMetric(metric1);

  const metric2: Partial<MetricInterface> = {
    id: uniqid("met_sample_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Sample Revenue per User",
    description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
    type: "revenue",
    organization: orgId,
    userIdType: "anonymous",
  };
  await insertMetric(metric2);

  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);

  const experiment: ExperimentInterface = {
    id: uniqid("exp_sample_"),
    organization: orgId,
    archived: false,
    name: "Sample Experiment",
    status: "stopped",
    description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
    hypothesis:
      "Making the buttons green on the pricing page will increase conversions",
    previewURL: "",
    targetURLRegex: "",
    sqlOverride: new Map(),
    variations: [
      {
        name: "Control",
        value: `{"color": "blue"}`,
        screenshots: [
          {
            path: "/images/pricing-default.png",
          },
        ],
      },
      {
        name: "Variation",
        value: `{"color": "green"}`,
        screenshots: [
          {
            path: "/images/pricing-green.png",
          },
        ],
      },
    ],
    autoAssign: false,
    autoSnapshots: false,
    datasource: null,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    implementation: "code",
    metrics: [metric1.id, metric2.id],
    owner: req.userId,
    trackingKey: "sample-experiment",
    userIdType: "anonymous",
    tags: [],
    results: "won",
    winner: 1,
    analysis: `Calling this test a winner given the significant increase in conversions! 💵 🍾

Revenue did not reach 95% significance, but the risk is so low it doesn't seem worth it to keep waiting.

**Ready to get some wins yourself?** [Finish setting up your account](/getstarted)`,
    phases: [
      {
        dateStarted: lastWeek,
        dateEnded: new Date(),
        phase: "main",
        reason: "",
        coverage: 1,
        variationWeights: [0.5, 0.5],
        groups: [],
      },
    ],
  };
  await ExperimentModel.create(experiment);

  await createManualSnapshot(experiment, 0, [15500, 15400], {
    [metric1.id]: [
      {
        count: 950,
        mean: 1,
        stddev: 1,
      },
      {
        count: 1025,
        mean: 1,
        stddev: 1,
      },
    ],
    [metric2.id]: [
      {
        count: 950,
        mean: 26.54,
        stddev: 16.75,
      },
      {
        count: 1025,
        mean: 25.13,
        stddev: 16.87,
      },
    ],
  });

  res.status(200).json({
    status: 200,
    experiment: experiment.id,
  });
}

export async function getDefinitions(req: AuthRequest, res: Response) {
  const orgId = req.organization?.id;
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
  ] = await Promise.all([
    getMetricsByOrganization(orgId),
    getDataSourcesByOrganization(orgId),
    findDimensionsByOrganization(orgId),
    SegmentModel.find({
      organization: orgId,
    }),
    getAllTags(orgId),
    getAllGroups(orgId),
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
        params: integration.getNonSensitiveParams(),
      };
    }),
    dimensions,
    segments,
    tags,
    groups,
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
  try {
    const docs = await getWatchedAudits(req.userId, req.organization.id, {
      limit: 50,
    });

    if (!docs.length) {
      return res.status(200).json({
        status: 200,
        events: [],
        experiments: [],
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

export async function getWatchedExperiments(req: AuthRequest, res: Response) {
  try {
    const watch = await WatchModel.findOne({
      userId: req.userId,
      organization: req.organization.id,
    });
    res.status(200).json({
      status: 200,
      experiments: watch?.experiments || [],
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getHistory(req: AuthRequest, res: Response) {
  const { type, id }: { type: string; id: string } = req.params;

  const events = await Promise.all([
    findByEntity(type, id),
    findByEntityParent(type, id),
  ]);

  const merged = [...events[0], ...events[1]];

  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  if (merged.filter((e) => e.organization !== req.organization.id).length > 0) {
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

  try {
    await UserModel.updateOne(
      {
        id: req.userId,
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
  req: AuthRequest<{ role: MemberRole }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { role } = req.body;
  const { id }: { id: string } = req.params;

  if (id === req.userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
    });
  }

  let found = false;
  req.organization.members.forEach((m) => {
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
    await updateOrganization(req.organization.id, {
      members: req.organization.members,
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

  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const {
    invites,
    members,
    ownerEmail,
    name,
    url,
    subscription,
    connections,
    settings,
  } = req.organization;

  const roleMapping: Map<string, MemberRole> = new Map();
  members.forEach((m) => {
    roleMapping.set(m.id, m.role);
  });

  const users = await getUsersByIds(members.map((m) => m.id));

  const apiKeys = await getAllApiKeysByOrganization(req.organization.id);

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

export async function postInviteAccept(req: AuthRequest, res: Response) {
  const { key } = req.body;

  try {
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
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { email, role } = req.body;

  if (!req.organization) {
    return res.status(400).json({
      status: 400,
      message: "Must be part of an organization to invite users",
    });
  }

  const { emailSent, inviteUrl } = await inviteUser(
    req.organization,
    email,
    role
  );
  return res.status(200).json({
    status: 200,
    inviteUrl,
    emailSent,
  });
}

interface SignupBody {
  company: string;
}

export async function deleteMember(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;

  if (id === req.userId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot change your own role",
    });
  }

  if (!req.organization) {
    return res.status(400).json({
      status: 400,
      message: "Must be part of an organization to remove a member",
    });
  }

  await removeMember(req.organization, id);

  res.status(200).json({
    status: 200,
  });
}

export async function deleteDataSource(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;

  const datasource = await getDataSourceById(id, req.organization.id);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  // Make sure there are no metrics
  const metrics = await getMetricsByDatasource(
    datasource.id,
    datasource.organization
  );
  if (metrics.length > 0) {
    throw new Error(
      "Error: Please delete all metrics tied to this datasource first."
    );
  }

  // Make sure there are no segments
  const segments = await SegmentModel.find({
    datasource: datasource.id,
  });
  if (segments.length > 0) {
    throw new Error(
      "Error: Please delete all segments tied to this datasource first."
    );
  }

  // Make sure there are no dimensions
  const dimensions = await findDimensionsByDataSource(
    datasource.id,
    datasource.organization
  );
  if (dimensions.length > 0) {
    throw new Error(
      "Error: Please delete all dimensions tied to this datasource first."
    );
  }

  await deleteDatasourceById(datasource.id);

  res.status(200).json({
    status: 200,
  });
}

export async function postInviteResend(
  req: AuthRequest<{ key: string }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { key } = req.body;

  if (!req.organization) {
    return res.status(400).json({
      status: 400,
      message: "Must be part of an organization to remove an invitation",
    });
  }

  let emailSent = false;
  try {
    await sendInviteEmail(req.organization, key);
    emailSent = true;
  } catch (e) {
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
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { key } = req.body;

  if (!req.organization) {
    return res.status(400).json({
      status: 400,
      message: "Must be part of an organization to remove an invitation",
    });
  }

  await revokeInvite(req.organization, key);

  res.status(200).json({
    status: 200,
  });
}

export async function signup(req: AuthRequest<SignupBody>, res: Response) {
  const { company } = req.body;

  try {
    if (company.length < 3) {
      throw Error("Company length must be at least 3 characters");
    }
    const org = await createOrganization(req.email, req.userId, company, "");

    // Alert the site manager about new organizations that are created
    try {
      await sendNewOrgEmail(company, req.email);
    } catch (e) {
      console.error("New org email sending failure:");
      console.error(e.message);
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
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { name, settings } = req.body;

  try {
    const updates: Partial<OrganizationInterface> = {};

    if (name) {
      updates.name = name;
    }
    if (settings) {
      updates.settings = settings;
    }

    await updateOrganization(req.organization.id, updates);

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

export async function getDataSources(req: AuthRequest, res: Response) {
  const datasources = await getDataSourcesByOrganization(req.organization.id);

  if (!datasources || !datasources.length) {
    res.status(200).json({
      status: 200,
      datasources: [],
    });
    return;
  }

  res.status(200).json({
    status: 200,
    datasources: datasources.map((d) => {
      const integration = getSourceIntegrationObject(d);
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        settings: d.settings,
        params: integration.getNonSensitiveParams(),
      };
    }),
  });
}

export async function getDataSource(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;

  const datasource = await getDataSourceById(id, req.organization.id);
  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }

  const integration = getSourceIntegrationObject(datasource);

  res.status(200).json({
    id: datasource.id,
    name: datasource.name,
    type: datasource.type,
    params: integration.getNonSensitiveParams(),
    settings: datasource.settings,
  });
}

export async function postDataSources(
  req: AuthRequest<{
    name: string;
    type: DataSourceType;
    params: DataSourceParams;
    settings: DataSourceSettings;
  }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { name, type, params } = req.body;
  const settings = req.body.settings || {};

  try {
    // Set default event properties and queries
    settings.events = {
      experimentEvent: "$experiment_started",
      experimentIdProperty: "Experiment name",
      variationIdProperty: "Variant name",
      pageviewEvent: "Page view",
      urlProperty: "$current_url",
      ...settings?.events,
    };

    const schema = (params as PostgresConnectionParams)?.defaultSchema;

    settings.queries = {
      experimentsQuery: `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  experiment_id,
  variation_id
FROM
  ${schema ? schema + "." : ""}experiment_viewed`,
      pageviewsQuery: `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  path as url
FROM
  ${schema ? schema + "." : ""}pages`,
      ...settings?.queries,
    };

    const datasource = await createDataSource(
      req.organization.id,
      name,
      type,
      params,
      settings
    );

    res.status(200).json({
      status: 200,
      id: datasource.id,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function getTags(req: AuthRequest, res: Response) {
  const tags = await getAllTags(req.organization.id);
  res.status(200).json({
    status: 200,
    tags,
  });
}

export async function putDataSource(
  req: AuthRequest<{
    name: string;
    type: DataSourceType;
    params: DataSourceParams;
    settings: DataSourceSettings;
  }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;
  const { name, type, params, settings } = req.body;

  const datasource = await getDataSourceById(id, req.organization.id);
  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }

  if (type !== datasource.type) {
    res.status(400).json({
      status: 400,
      message:
        "Cannot change the type of an existing data source. Create a new one instead.",
    });
    return;
  }

  try {
    const updates: Partial<DataSourceInterface> = {
      name,
      dateUpdated: new Date(),
      settings,
    };

    if (
      type === "google_analytics" &&
      (params as GoogleAnalyticsParams).refreshToken
    ) {
      const oauth2Client = getOauth2Client();
      const { tokens } = await oauth2Client.getToken(
        (params as GoogleAnalyticsParams).refreshToken
      );
      (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token;
    }

    const newParams = mergeAndEncryptParams(params, datasource.params);
    if (newParams !== datasource.params) {
      // If the connection params changed, re-validate the connection
      // If the user is just updating the display name, no need to do this
      updates.params = newParams;
      await testDataSourceConnection({
        ...datasource,
        ...updates,
      });
    }

    await updateDataSource(id, updates);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function getApiKeys(req: AuthRequest, res: Response) {
  const keys = await getAllApiKeysByOrganization(req.organization.id);
  res.status(200).json({
    status: 200,
    keys,
  });
}

export async function postApiKey(
  req: AuthRequest<{ description?: string }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { description } = req.body;

  const key = await createApiKey(req.organization.id, description);

  res.status(200).json({
    status: 200,
    key,
  });
}

export async function deleteApiKey(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { key }: { key: string } = req.params;

  await deleteByOrganizationAndApiKey(req.organization.id, key);

  res.status(200).json({
    status: 200,
  });
}

export async function getWebhooks(req: AuthRequest, res: Response) {
  const webhooks = await WebhookModel.find({
    organization: req.organization.id,
  });
  res.status(200).json({
    status: 200,
    webhooks,
  });
}

export async function postWebhook(
  req: AuthRequest<{ name: string; endpoint: string }>,
  res: Response
) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { name, endpoint } = req.body;

  const webhook = await createWebhook(req.organization.id, name, endpoint);

  res.status(200).json({
    status: 200,
    webhook,
  });
}

export async function deleteWebhook(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;

  await WebhookModel.deleteOne({
    organization: req.organization.id,
    id,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postGoogleOauthRedirect(req: AuthRequest, res: Response) {
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const oauth2Client = getOauth2Client();

  const url = oauth2Client.generateAuthUrl({
    // eslint-disable-next-line
    access_type: "offline",
    // eslint-disable-next-line
    include_granted_scopes: true,
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
  });

  res.status(200).json({
    status: 200,
    url,
  });
}

export async function getQueries(req: AuthRequest, res: Response) {
  const { ids }: { ids: string } = req.params;
  const queries = ids.split(",");

  const docs = await QueryModel.find({
    organization: req.organization.id,
    id: {
      $in: queries,
    },
  });

  // Lookup table so we can return queries in the same order we received them
  const map = new Map();
  docs.forEach((doc) => {
    // If we haven't gotten a heartbeat in a while, change the status to failed
    if (
      doc.status === "running" &&
      Date.now() - doc.heartbeat.getTime() > 120000
    ) {
      doc.set("status", "failed");
      doc.set("error", "Query aborted");
      doc.save();
    }

    map.set(doc.id, doc);
  });

  res.status(200).json({
    queries: queries.map((id) => map.get(id) || null),
  });
}

export async function putUpload(req: Request, res: Response) {
  const { signature, path } = req.query as { signature: string; path: string };
  await uploadFile(path, signature, req.body);

  res.status(200).json({
    status: 200,
  });
}
