import type { Response } from "express";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { PostgresConnectionParams } from "../../../types/integrations/postgres";
import { createDataSource } from "../../models/DataSourceModel";
import { createExperiment } from "../../models/ExperimentModel";
import { createProject, findProjectById } from "../../models/ProjectModel";
import { createMetric, createSnapshot } from "../../services/experiments";
import { PrivateApiErrorResponse } from "../../../types/api";
import { DataSourceSettings } from "../../../types/datasource";
import { ExperimentInterface } from "../../../types/experiment";
import { FeatureInterface } from "../../../types/feature";
import { MetricInterface } from "../../../types/metric";
import { ProjectInterface } from "../../../types/project";
import { ExperimentSnapshotAnalysisSettings } from "../../../types/experiment-snapshot";
import { getMetricMap } from "../../models/MetricModel";
import { createFeature } from "../../models/FeatureModel";

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
          "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nexperimentId AS experiment_id,\nvariationId AS variation_id,\nbrowser\nFROM experiment_viewed",
        dimensions: ["browser"],
      },
    ],
  },
};

const DEMO_DATASOURCE_PARAMS: PostgresConnectionParams = {
  user: "gbdemoreader",
  host: "sample-data.growthbook.io",
  database: "growthbook",
  password: "WnGeRgTPwEu4",
  port: 5432,
  ssl: true,
  defaultSchema: "sample",
};

const ASSET_OWNER = "";
const DEMO_TAGS = ["growthbook-demo"];

// Metric constants
const DENOMINATOR_METRIC_NAME = "Purchases - Number of Orders (72 hour window)";
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
    name: DENOMINATOR_METRIC_NAME,
    description: "Total number of discrete orders placed by a user",
    type: "count",
    sql:
      "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\n1 AS value\nFROM orders",
  },
  {
    name: "Retention - [1, 14) Days",
    description:
      "Whether the user logged in 1-14 days after experiment exposure",
    type: "binomial",
    conversionDelayHours: 24,
    conversionWindowHours: 144 + 168,
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

// Feature constants
const DEMO_FEATURES: Omit<
  FeatureInterface,
  "id" | "organization" | "dateCreated" | "dateUpdated"
>[] = [
  {
    description:
      "Controls checkout layout UI. Employees forced to see new UI, other users randomly assigned to one of three designs.",
    owner: ASSET_OWNER,
    valueType: "string",
    defaultValue: "current",
    tags: DEMO_TAGS,
    environmentSettings: {
      production: {
        enabled: true,
        rules: [
          {
            type: "force",
            description: "",
            id: "gbdemo-checkout-layout-employee-force-rule",
            value: "dev",
            condition: `{"is_employee":true}`,
            enabled: true,
          },
          {
            type: "experiment",
            description: "",
            id: "gbdemo-checkout-layout-exp-rule",
            trackingKey: "gbdemo-checkout-layout",
            hashAttribute: "user_id",
            coverage: 1,
            enabled: true,
            values: [
              {
                value: "current",
                weight: 0.3334,
              },
              {
                value: "dev-compact",
                weight: 0.3333,
              },
              {
                value: "dev",
                weight: 0.3333,
              },
            ],
          },
        ],
      },
    },
  },
];

// Experiment constants
const EXPERIMENT_START_DATE = new Date();
EXPERIMENT_START_DATE.setDate(EXPERIMENT_START_DATE.getDate() - 30);
const DEMO_EXPERIMENTS: Pick<
  ExperimentInterface,
  | "name"
  | "description"
  | "hypothesis"
  | "trackingKey"
  | "variations"
  | "phases"
>[] = [
  {
    name: "gbdemo-checkout-layout",
    trackingKey: "gbdemo-checkout-layout",
    description: `**THIS IS A DEMO EXPERIMENT USED FOR DEMONSTRATION PURPOSES ONLY**

Experiment to test impact of checkout cart design.
Both variations move the "Proceed to checkout" button to a single table, but with different
spacing and headings.`,
    hypothesis: `We predict new variations will increase Purchase metrics and have uncertain effects on Retention.`,
    variations: [
      {
        id: "0",
        key: "0",
        name: "Current",
        screenshots: [
          {
            path: "/images/demo-datasource/current.png",
          },
        ],
      },
      {
        id: "0",
        key: "1",
        name: "Dev-Compact",
        screenshots: [
          {
            path: "/images/demo-datasource/dev-compact.png",
          },
        ],
      },
      {
        id: "0",
        key: "2",
        name: "Dev",
        screenshots: [
          {
            path: "/images/demo-datasource/dev.png",
          },
        ],
      },
    ],
    phases: [
      {
        dateStarted: EXPERIMENT_START_DATE,
        name: "",
        reason: "",
        coverage: 1,
        condition: "",
        namespace: { enabled: false, name: "", range: [0, 1] },
        variationWeights: [0.3334, 0.3333, 0.3333],
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

  const demoProjId = getDemoDatasourceProjectIdForOrganization(org.id);
  const existingDemoProject: ProjectInterface | null = await findProjectById(
    demoProjId,
    org.id
  );

  if (existingDemoProject) {
    res.status(200).json({
      status: 200,
      project: existingDemoProject,
    });
    return;
  }

  try {
    const project = await createProject(org.id, {
      id: demoProjId,
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
          owner: ASSET_OWNER,
          userIdColumns: { user_id: "user_id" },
          userIdTypes: ["user_id"],
          datasource: datasource.id,
          projects: [project.id],
          tags: DEMO_TAGS,
        });
      })
    );

    const denominatorMetricId = metrics.find(
      (m) => m.name === DENOMINATOR_METRIC_NAME
    )?.id;
    const ratioMetric = denominatorMetricId
      ? await createMetric({
          ...DEMO_RATIO_METRIC,
          denominator: denominatorMetricId,
          organization: org.id,
          owner: ASSET_OWNER,
          userIdColumns: { user_id: "user_id" },
          userIdTypes: ["user_id"],
          datasource: datasource.id,
          projects: [project.id],
          tags: DEMO_TAGS,
        })
      : undefined;

    // Create feature
    await Promise.all(
      DEMO_FEATURES.map(async (f) => {
        return createFeature(org, res.locals.eventAudit, {
          ...f,
          id: "gbdemo-checkout-layout",
          project: project.id,
          organization: org.id,
          dateCreated: new Date(),
          dateUpdated: new Date(),
        });
      })
    );

    // Create experiment
    const experiments = await Promise.all(
      DEMO_EXPERIMENTS.map(async (e) => {
        return createExperiment({
          data: {
            ...e,
            owner: ASSET_OWNER,
            datasource: datasource.id,
            project: project.id,
            metrics: metrics
              .map((m) => m.id)
              .concat(ratioMetric ? ratioMetric?.id : []),
            exposureQueryId: "user_id",
            status: "running",
            tags: DEMO_TAGS,
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
