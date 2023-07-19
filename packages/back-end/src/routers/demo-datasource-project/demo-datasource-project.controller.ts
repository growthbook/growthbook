import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { createProject, deleteProjectById } from "../../models/ProjectModel";
//import { getDemoDatasourceProjectIdForOrganization } from "shared/src/demo-datasource/demo-datasource.utils";
import { PostgresConnectionParams } from "../../../types/integrations/postgres";
import { createDataSource } from "../../models/DataSourceModel";
import { createMetric } from "../../services/experiments";
import { DataSourceSettings } from "../../../types/datasource";
import { ExperimentInterface } from "../../../types/experiment";
import { MetricInterface } from "../../../types/metric";
import { createExperiment } from "../../models/ExperimentModel";
import { ProjectInterface } from "../../../types/project";

// region POST /demo-datasource-project
const DEMO_PROJECT_ID_SEPARATOR = "_";
const DEMO_PROJECT_ID_SUFFIX = "demo-datasource-project";

function getDemoDatasourceProjectIdForOrganization(
  organizationId: string
): string {
  return (
    "prj" +
    DEMO_PROJECT_ID_SEPARATOR +
    organizationId +
    DEMO_PROJECT_ID_SEPARATOR +
    DEMO_PROJECT_ID_SUFFIX
  );
}

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

    // Create experiments
    await Promise.all(
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
                variationWeights: [0.5, 0.5],
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

    res.status(200).json({
      status: 200,
      project: project,
    });
    // TODO create experiment snapshots?
  } catch (e) {
    res.status(403).json({
      status: 403,
      message: e.message,
    });
  }
  return;
};

// endregion POST /demo-datasource-project
