import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from '../../events/event-types';
import { createProject } from "../../models/ProjectModel";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource/demo-datasource.utils";
import { PostgresConnectionParams } from "../../../types/integrations/postgres";
import { createDataSource } from "../../models/DataSourceModel";
import { createMetric } from "../../services/experiments";
import { DataSourceSettings } from "../../../types/datasource";
import { ExperimentInterface } from "../../../types/experiment";
import { MetricInterface } from "../../../types/metric";
import { createExperiment } from "../../models/ExperimentModel";

// region POST /demo-datasource-project

type CreateDemoDatasourceProjectRequest = AuthRequest<{ name: string; description: string }>;

type CreateDemoDatasourceProjectResponse = {
  demoDatasourceProject: unknown;
};

/**
 * START Constants for Demo Datasource
 */

// Datasource constants
const DATASOURCE_TYPE = "postgres"
const DEMO_DATASOURCE_SETTINGS: DataSourceSettings = {
};

const DEMO_DATASOURCE_PARAMS: PostgresConnectionParams = {
  user: "string",
  host: "string",
  database: "string",
  password: "string",
  port: 0,
  ssl: "string | boolean",
  defaultSchema: "string",
};

// Metric constants
const METRIC_OWNER = 'datascience@growthbook.io';
const DEMO_METRICS: Pick<MetricInterface, 'name' | 'description' | 'type' | 'sql' | 'conversionWindowHours' | 'conversionDelayHours' | 'aggregation'>[] = [
  {
    name: "Purchases - Total Revenue (72 hour window)",
    description: "The total amount of USD spent aggregated at the user level",
    type: "revenue",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value FROM purchases",
  },
  {
    name: "Purchases - Any Order (72 hour window)",
    description: "Whether the user places any order or not (0/1)",
    type: "binomial",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp FROM purchases",
  },
  {
    name: "Purchases - Number of Orders (72 hour window)",
    description: "Total number of discrete orders placed by a user",
    type: "count",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\n1 AS value FROM purchases",
  },
  {
    name: "Retention - [1, 7) Days",
    description: "Whether the user logged in 1-7 days after experiment exposure",
    type: "binomial",
    conversionDelayHours: 24,
    conversionWindowHours: 144,
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp FROM pageViews WHERE path = '/'"
  },
  {
    name: "Retention - [7, 14) Days",
    description: "Whether the user logged in 7-14 days after experiment exposure",
    type: "binomial",
    conversionDelayHours: 168,
    conversionWindowHours: 168,
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp FROM pageViews WHERE path = '/'"
  },
  {
    name: "Days Active in Next 7 Days",
    description: "Count of times the user was active in the next 7 days after exposure",
    type: "count",
    conversionWindowHours: 168,
    aggregation: "COUNT(DISTINCT value)",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nDATE_TRUNC('day', timestamp) AS value FROM pageViews WHERE path = '/'"
  }
]

const DEMO_RATIO_METRIC: Pick<MetricInterface, 'name' | 'description' | 'type' | 'sql'> = {
  name: "Purcahses - Average Order Value (ratio)",
  description: "The average value of purchases made in the 72 hours after exposure divided by the total number of purchases",
  type: "revenue",
  sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value FROM purchases"
};


// Experiment constants
const DEMO_EXPERIMENTS: Pick<ExperimentInterface, 'name' | 'trackingKey' | 'variations'>[] = [
  {
    name: "checkout-layout",
    trackingKey: "checkout-layout",
    variations: [
      {
        id: "0",
        key: "0",
        name: "Control",
        screenshots: []
      },
      {
        id: "0",
        key: "1",
        name: "Compact",
        screenshots: []
      },
      {
        id: "0",
        key: "2",
        name: "Spaced Out",
        screenshots: []
      }
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
        screenshots: []
      },
      {
        id: "0",
        key: "1",
        name: "Hide discount",
        screenshots: []
      },
    ],
  },
]

/**
 * END Constants for Demo Datasource
 */

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
  const statsEngine = org.settings?.statsEngine || DEFAULT_STATS_ENGINE;

  try {
    const project = await createProject(org.id, {
      name: getDemoDatasourceProjectIdForOrganization(org.id),
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
    const metrics = await Promise.all(DEMO_METRICS.map(async (m) => {
      return createMetric({
        ...m, 
        owner: METRIC_OWNER, 
        datasource: datasource.id,
        projects: [project.id],
        tags: ["growthbook-demo-datasource"],
      });
    }));

    const ratioMetric = await createMetric({
      ...DEMO_RATIO_METRIC,
      denominator: metrics.find(x => x.name === "Purchases - Number of Orders (72 hour window)")?.id,
      owner: METRIC_OWNER, 
      datasource: datasource.id,
      projects: [project.id],
      tags: ["growthbook-demo-datasource"],
    });

    // Create experiments
    const experiments = await Promise.all(DEMO_EXPERIMENTS.map(async (e) => {
      return createExperiment({
        data: {
          ...e, 
          owner: METRIC_OWNER, 
          datasource: datasource.id,
          project: project.id,
          tags: ["growthbook-demo-datasource"],
        },
        organization: org,
        user: ''
      });
    }));
  } catch {
    throw new Error('TODO');
  }
};

// endregion POST /demo-datasource-project