import { Response } from "express";
import uniqid from "uniqid";
import { AuthRequest } from "../types/AuthRequest";
import { getOrgFromReq } from "../services/organizations";
import {
  DataSourceParams,
  DataSourceType,
  DataSourceSettings,
  DataSourceInterface,
} from "../../types/datasource";
import {
  getSourceIntegrationObject,
  getNonSensitiveParams,
  mergeParams,
  encryptParams,
  testQuery,
} from "../services/datasource";
import { getOauth2Client } from "../integrations/GoogleAnalytics";
import {
  ExperimentModel,
  logExperimentCreated,
} from "../models/ExperimentModel";
import { QueryModel } from "../models/QueryModel";
import {
  createManualSnapshot,
  getSampleExperiment,
} from "../services/experiments";
import { SegmentModel } from "../models/SegmentModel";
import { findDimensionsByDataSource } from "../models/DimensionModel";
import {
  createDataSource,
  getDataSourcesByOrganization,
  getDataSourceById,
  deleteDatasourceById,
  updateDataSource,
} from "../models/DataSourceModel";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import {
  insertMetric,
  getMetricsByDatasource,
  getSampleMetrics,
} from "../models/MetricModel";

export async function postSampleData(req: AuthRequest, res: Response) {
  req.checkPermissions("createMetrics", "");
  req.checkPermissions("createAnalyses", "");

  const { org, userId } = getOrgFromReq(req);
  const orgId = org.id;
  const statsEngine = org.settings?.statsEngine;

  const existingMetrics = await getSampleMetrics(orgId);

  let metric1 = existingMetrics.filter((m) => m.type === "binomial")[0];
  if (!metric1) {
    metric1 = {
      id: uniqid("met_sample_"),
      datasource: "",
      owner: "",
      ignoreNulls: false,
      inverse: false,
      queries: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      runStarted: null,
      name: "Sample Conversions",
      description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
      type: "binomial",
      organization: orgId,
      userIdType: "anonymous",
    };
    await insertMetric(metric1);
  }

  let metric2 = existingMetrics.filter((m) => m.type === "revenue")[0];
  if (!metric2) {
    metric2 = {
      id: uniqid("met_sample_"),
      datasource: "",
      owner: "",
      ignoreNulls: false,
      inverse: false,
      queries: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      runStarted: null,
      name: "Sample Revenue per User",
      description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
      type: "revenue",
      organization: orgId,
      userIdType: "anonymous",
    };
    await insertMetric(metric2);
  }

  let experiment = await getSampleExperiment(orgId);

  if (!experiment) {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    experiment = {
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
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      implementation: "code",
      metrics: [metric1.id, metric2.id],
      owner: userId,
      trackingKey: "sample-experiment",
      exposureQueryId: "",
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

    const createdExperiment = await ExperimentModel.create(experiment);
    await logExperimentCreated(org, createdExperiment);

    await createManualSnapshot(
      experiment,
      0,
      [15500, 15400],
      {
        [metric1.id]: [
          {
            users: 15500,
            count: 950,
            mean: 1,
            stddev: 1,
          },
          {
            users: 15400,
            count: 1025,
            mean: 1,
            stddev: 1,
          },
        ],
        [metric2.id]: [
          {
            users: 15500,
            count: 950,
            mean: 26.54,
            stddev: 16.75,
          },
          {
            users: 15400,
            count: 1025,
            mean: 25.13,
            stddev: 16.87,
          },
        ],
      },
      statsEngine
    );
  }

  res.status(200).json({
    status: 200,
    experiment: experiment.id,
  });
}

export async function deleteDataSource(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const datasource = await getDataSourceById(id, org.id);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }
  req.checkPermissions(
    "createDatasources",
    datasource?.projects?.length ? datasource.projects : ""
  );

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

  await deleteDatasourceById(datasource.id, org.id);

  res.status(200).json({
    status: 200,
  });
}

export async function getDataSources(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const datasources = await getDataSourcesByOrganization(org.id);

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
        description: d.description,
        type: d.type,
        settings: d.settings,
        projects: d.projects ?? [],
        params: getNonSensitiveParams(integration),
      };
    }),
  });
}

export async function getDataSource(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const datasource = await getDataSourceById(id, org.id);
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
    description: datasource.description,
    type: datasource.type,
    params: getNonSensitiveParams(integration),
    settings: datasource.settings,
    projects: datasource.projects,
  });
}

export async function postDataSources(
  req: AuthRequest<{
    name: string;
    description?: string;
    type: DataSourceType;
    params: DataSourceParams;
    settings: DataSourceSettings;
    projects?: string[];
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { name, description, type, params, projects } = req.body;
  const settings = req.body.settings || {};

  req.checkPermissions("createDatasources", projects?.length ? projects : "");

  try {
    // Set default event properties and queries
    settings.events = {
      experimentEvent: "$experiment_started",
      experimentIdProperty: "Experiment name",
      variationIdProperty: "Variant name",
      ...settings?.events,
    };

    const datasource = await createDataSource(
      org.id,
      name,
      type,
      params,
      settings,
      undefined,
      description,
      projects
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

export async function putDataSource(
  req: AuthRequest<
    {
      name: string;
      description?: string;
      type: DataSourceType;
      params: DataSourceParams;
      settings: DataSourceSettings;
      projects?: string[];
    },
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { name, description, type, params, settings, projects } = req.body;

  const datasource = await getDataSourceById(id, org.id);
  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }
  // Require higher permissions to change connection settings vs updating query settings
  const permissionLevel = params
    ? "createDatasources"
    : "editDatasourceSettings";
  req.checkPermissions(
    permissionLevel,
    datasource?.projects?.length ? datasource.projects : ""
  );

  if (type && type !== datasource.type) {
    res.status(400).json({
      status: 400,
      message:
        "Cannot change the type of an existing data source. Create a new one instead.",
    });
    return;
  }

  try {
    const updates: Partial<DataSourceInterface> = {
      dateUpdated: new Date(),
    };

    if (name) {
      updates.name = name;
    }
    if (description) {
      updates.description = description;
    }
    if (settings) {
      updates.settings = settings;
    }
    if (projects) {
      updates.projects = projects;
    }

    if (
      type === "google_analytics" &&
      params &&
      (params as GoogleAnalyticsParams).refreshToken
    ) {
      const oauth2Client = getOauth2Client();
      const { tokens } = await oauth2Client.getToken(
        (params as GoogleAnalyticsParams).refreshToken
      );
      (params as GoogleAnalyticsParams).refreshToken =
        tokens.refresh_token || "";
    }

    if (updates?.projects?.length) {
      req.checkPermissions(permissionLevel, updates.projects);
    }

    // If the connection params changed, re-validate the connection
    // If the user is just updating the display name, no need to do this
    if (params) {
      const integration = getSourceIntegrationObject(datasource);
      mergeParams(integration, params);
      await integration.testConnection();
      updates.params = encryptParams(integration.params);
    }

    await updateDataSource(id, org.id, updates);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Failed to update data source");
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function postGoogleOauthRedirect(req: AuthRequest, res: Response) {
  req.checkPermissions("createDatasources", "");

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

export async function getQueries(
  req: AuthRequest<null, { ids: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { ids } = req.params;
  const queries = ids.split(",");

  const docs = await QueryModel.find({
    organization: org.id,
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

export async function testLimitedQuery(
  req: AuthRequest<{
    query: string;
    datasourceId: string;
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const { query, datasourceId } = req.body;

  const datasource = await getDataSourceById(datasourceId, org.id);
  if (!datasource) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
  }
  req.checkPermissions(
    "editDatasourceSettings",
    datasource?.projects?.length ? datasource.projects : ""
  );

  const { results, sql, duration, error } = await testQuery(datasource, query);

  res.status(200).json({
    status: 200,
    duration,
    results,
    sql,
    error,
  });
}
