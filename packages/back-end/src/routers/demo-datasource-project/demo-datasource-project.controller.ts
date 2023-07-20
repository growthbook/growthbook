import type { Response } from "express";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { PostgresConnectionParams } from "../../../types/integrations/postgres";
import { createDataSource } from "../../models/DataSourceModel";
import { createExperiment } from "../../models/ExperimentModel";
import { createProject, deleteProjectById } from "../../models/ProjectModel";
import { createMetric, createSnapshot } from "../../services/experiments";
import { DataSourceSettings } from "../../../types/datasource";
import { ExperimentInterface } from "../../../types/experiment";
import { MetricInterface } from "../../../types/metric";
import { ProjectInterface } from "../../../types/project";
import { ExperimentSnapshotAnalysisSettings } from "../../../types/experiment-snapshot";
import { getMetricMap } from "../../models/MetricModel";

/**
 * START Constants for Demo Datasource
 */

// Datasource constants
const DATASOURCE_TYPE = "postgres";
const DEMO_DATASOURCE_SETTINGS: DataSourceSettings = {
  userIdTypes: [{ userIdType: "user_id" }],
  queries: {
    exposure: [
      {
        id: "user_id",
        name: "Logged-in User Experiments",
        userIdType: "user_id",
        query:
          "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nexperimentId AS experiment_id,\nvariationId AS variation_id\nFROM experiment_viewed",
        dimensions: [],
      },
    ],
  },
};

const DEMO_DATASOURCE_PARAMS: PostgresConnectionParams = {
  user: "lukesonnet",
  host: "localhost",
  database: "sample",
  password: "",
  port: 5432,
  ssl: false,
  defaultSchema: "",
};

// Metric constants
const METRIC_OWNER = "datascience@growthbook.io";
const DEMO_METRICS: Pick<
  MetricInterface,
  | "name"
  | "description"
  | "type"
  | "sql"
  | "conversionWindowHours"
  | "conversionDelayHours"
  | "aggregation"
>[] = [
  {
    name: "Purchases - Total Revenue (72 hour window)",
    description: "The total amount of USD spent aggregated at the user level",
    type: "revenue",
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value\nFROM orders",
  },
  {
    name: "Purchases - Any Order (72 hour window)",
    description: "Whether the user places any order or not (0/1)",
    type: "binomial",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp\nFROM orders",
  },
  {
    name: "Purchases - Number of Orders (72 hour window)",
    description: "Total number of discrete orders placed by a user",
    type: "count",
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\n1 AS value\nFROM orders",
  },
  {
    name: "Retention - [1, 7) Days",
    description:
      "Whether the user logged in 1-7 days after experiment exposure",
    type: "binomial",
    conversionDelayHours: 24,
    conversionWindowHours: 144,
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp\nFROM pages WHERE path = '/'",
  },
  {
    name: "Retention - [7, 14) Days",
    description:
      "Whether the user logged in 7-14 days after experiment exposure",
    type: "binomial",
    conversionDelayHours: 168,
    conversionWindowHours: 168,
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp\nFROM pages WHERE path = '/'",
  },
  {
    name: "Days Active in Next 7 Days",
    description:
      "Count of times the user was active in the next 7 days after exposure",
    type: "count",
    conversionWindowHours: 168,
    aggregation: "COUNT(DISTINCT value)",
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nDATE_TRUNC('day', timestamp) AS value\nFROM pages WHERE path = '/'",
  },
];

const DEMO_RATIO_METRIC: Pick<
  MetricInterface,
  "name" | "description" | "type" | "sql"
> = {
  name: "Purchases - Average Order Value (ratio)",
  description:
    "The average value of purchases made in the 72 hours after exposure divided by the total number of purchases",
  type: "revenue",
  sql:
    "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value\nFROM orders",
};

// Experiment constants
const DEMO_EXPERIMENTS: Pick<
  ExperimentInterface,
  "name" | "trackingKey" | "variations"
>[] = [
  {
    name: "checkout-layout",
    trackingKey: "checkout-layout",
    variations: [
      {
        id: "0",
        key: "0",
        name: "Control",
        screenshots: [],
      },
      {
        id: "0",
        key: "1",
        name: "Compact",
        screenshots: [],
      },
      {
        id: "0",
        key: "2",
        name: "Spaced Out",
        screenshots: [],
      },
    ],
  },
  {
    name: "price-display",
    trackingKey: "price-display",
    variations: [
      {
        id: "0",
        key: "0",
        name: "Control",
        screenshots: [],
      },
      {
        id: "0",
        key: "1",
        name: "Hide discount",
        screenshots: [],
      },
    ],
  },
];

/**
 * END Constants for Demo Datasource
 */

// region POST /demo-datasource-project

type CreateDemoDatasourceProjectRequest = AuthRequest;

type CreateDemoDatasourceProjectResponse = {
  status: 200;
  project: ProjectInterface;
};

/**
 * POST /demo-datasource-project
 * Create a demo-datasource-project resource
 * @param req
 * @param res
 */
export const postDemoDatasourceProject = async (
  req: CreateDemoDatasourceProjectRequest,
  res: Response<
    CreateDemoDatasourceProjectResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("manageProjects", "");
  req.checkPermissions("createDatasources", "");
  req.checkPermissions("createMetrics", "");
  req.checkPermissions("createAnalyses", "");

  const { org } = getOrgFromReq(req);

  try {
    // TODO smarter management for cases when project exists
    // TODO throw appropriate error after each step
    await deleteProjectById(
      getDemoDatasourceProjectIdForOrganization(org.id),
      org.id
    );

    const project = await createProject(org.id, {
      id: getDemoDatasourceProjectIdForOrganization(org.id),
      name: "GrowthBook Demo Project",
      description: "GrowthBook Demo Project",
    });

    const datasource = await createDataSource(
      org.id,
      "GrowthBook Demo Postgres Datasource",
      DATASOURCE_TYPE,
      DEMO_DATASOURCE_PARAMS,
      DEMO_DATASOURCE_SETTINGS,
      undefined,
      "Datasource used for demoing GrowthBook Metrics, Experiments, and Datasource Connections",
      [project.id]
    );

    // Create metrics
    const metrics = await Promise.all(
      DEMO_METRICS.map(async (m) => {
        return createMetric({
          ...m,
          organization: org.id,
          owner: METRIC_OWNER,
          userIdColumns: { user_id: "user_id" },
          userIdTypes: ["user_id"],
          datasource: datasource.id,
          projects: [project.id],
          tags: ["growthbook-demo"],
        });
      })
    );

    const ratioMetric = await createMetric({
      ...DEMO_RATIO_METRIC,
      denominator: metrics.find(
        (x) => x.name === "Purchases - Number of Orders (72 hour window)"
      )?.id,
      organization: org.id,
      owner: METRIC_OWNER,
      userIdColumns: { user_id: "user_id" },
      userIdTypes: ["user_id"],
      datasource: datasource.id,
      projects: [project.id],
      tags: ["growthbook-demo"],
    });

    // TODO create feature

    // Create experiments
    const experiments = await Promise.all(
      DEMO_EXPERIMENTS.map(async (e) => {
        return createExperiment({
          data: {
            ...e,
            owner: METRIC_OWNER,
            datasource: datasource.id,
            project: project.id,
            metrics: metrics.map((m) => m.id).concat(ratioMetric.id),
            exposureQueryId: "user_id",
            // TODO set correct date and variation
            phases: [
              {
                dateStarted: new Date(),
                name: "",
                reason: "",
                coverage: 1,
                condition: "",
                namespace: { enabled: false, name: "", range: [0, 1] },
                variationWeights:
                  e.name === "checkout-layout"
                    ? [0.3334, 0.3333, 0.3333]
                    : [0.5, 0.5],
              },
            ],
            status: "running",
            tags: ["growthbook-demo"],
          },
          organization: org,
          user: res.locals.eventAudit,
        });
      })
    );

    const analysisSettings: ExperimentSnapshotAnalysisSettings = {
      statsEngine: org.settings?.statsEngine || DEFAULT_STATS_ENGINE,
      dimensions: [],
    };

    const metricMap = await getMetricMap(org.id);

    await Promise.all(
      experiments.map(async (e) => {
        return createSnapshot({
          experiment: e,
          organization: org,
          phaseIndex: 0,
          analysisSettings: analysisSettings,
          metricRegressionAdjustmentStatuses: [],
          metricMap: metricMap,
          useCache: true,
        });
      })
    );

    res.status(200).json({
      status: 200,
      project: project,
    });
  } catch (e) {
    res.status(500).json({
      status: 500,
      message: `Failed to create demo datasource and project with message: ${e.message}`,
    });
  }
  return;
};

// endregion POST /demo-datasource-project
