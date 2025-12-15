import type { Response } from "express";
import {
  getDemoDataSourceFeatureId,
  getDemoDatasourceProjectIdForOrganization,
} from "shared/demo-datasource";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { EventUserForResponseLocals } from "back-end/types/events/event-types";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { createDataSource } from "back-end/src/models/DataSourceModel";
import {
  createExperiment,
  getAllExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  createMetric,
  createSnapshot,
} from "back-end/src/services/experiments";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { DataSourceSettings } from "back-end/types/datasource";
import { ExperimentInterface } from "back-end/types/experiment";
import { ExperimentRefRule, FeatureInterface } from "back-end/types/feature";
import { MetricInterface } from "back-end/types/metric";
import { ProjectInterface } from "back-end/types/project";
import { ExperimentSnapshotAnalysisSettings } from "back-end/types/experiment-snapshot";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { createFeature } from "back-end/src/models/FeatureModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { MetricWindowSettings } from "back-end/types/fact-table";

// region Constants for Demo Datasource

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
const CONVERSION_WINDOW_SETTINGS: MetricWindowSettings = {
  type: "conversion",
  windowUnit: "hours",
  windowValue: 72,
  delayUnit: "hours",
  delayValue: 0,
};
const DENOMINATOR_METRIC_NAME = "Purchases - Number of Orders (72 hour window)";
const DEMO_METRICS: Pick<
  MetricInterface,
  "name" | "description" | "type" | "sql" | "windowSettings" | "aggregation"
>[] = [
  {
    name: "Purchases - Total Revenue (72 hour window)",
    description: "The total amount of USD spent aggregated at the user level",
    type: "revenue",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value\nFROM orders",
    windowSettings: CONVERSION_WINDOW_SETTINGS,
  },
  {
    name: "Purchases - Any Order (72 hour window)",
    description: "Whether the user places any order or not (0/1)",
    type: "binomial",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp\nFROM orders",
    windowSettings: CONVERSION_WINDOW_SETTINGS,
  },
  {
    name: DENOMINATOR_METRIC_NAME,
    description: "Total number of discrete orders placed by a user",
    type: "count",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\n1 AS value\nFROM orders",
    windowSettings: CONVERSION_WINDOW_SETTINGS,
  },
  {
    name: "Retention - [1, 14) Days",
    description:
      "Whether the user logged in 1-14 days after experiment exposure",
    type: "binomial",
    windowSettings: {
      type: "conversion",
      delayValue: 24,
      delayUnit: "hours",
      windowUnit: "days",
      windowValue: 13,
    },
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp\nFROM pages WHERE path = '/'",
  },
  {
    name: "Days Active in Next 7 Days",
    description:
      "Count of times the user was active in the next 7 days after exposure",
    type: "count",
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowUnit: "days",
      windowValue: 7,
    },
    aggregation: "COUNT(DISTINCT value)",
    sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nDATE_TRUNC('day', timestamp) AS value\nFROM pages WHERE path = '/'",
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
  sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value\nFROM orders",
};

// endregion Constants for Demo Datasource

// region POST /demo-datasource-project

type CreateDemoDatasourceProjectRequest = AuthRequest;

type CreateDemoDatasourceProjectResponse = {
  status: 200;
  project: ProjectInterface;
  experimentId: string;
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
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateProjects()) {
    context.permissions.throwPermissionError();
  }
  req.checkPermissions("createAnalyses", "");

  const { org, environments } = context;

  const demoProjId = getDemoDatasourceProjectIdForOrganization(org.id);

  if (
    !context.permissions.canCreateMetric({ projects: [demoProjId] }) ||
    !context.permissions.canCreateDataSource({
      projects: [demoProjId],
      type: "postgres",
    })
  ) {
    context.permissions.throwPermissionError();
  }

  const existingDemoProject: ProjectInterface | null =
    await context.models.projects.getById(demoProjId);

  if (existingDemoProject) {
    const existingExperiments = await getAllExperiments(context, {
      project: existingDemoProject.id,
      includeArchived: true,
    });

    res.status(200).json({
      status: 200,
      project: existingDemoProject,
      experimentId: existingExperiments[0]?.id || "",
    });
    return;
  }

  try {
    const project = await context.models.projects.create({
      id: demoProjId,
      name: "Sample Data",
    });
    const datasource = await createDataSource(
      context,
      "Sample Data Source",
      DATASOURCE_TYPE,
      DEMO_DATASOURCE_PARAMS,
      DEMO_DATASOURCE_SETTINGS,
      undefined,
      "",
      [project.id],
    );

    // Create metrics
    const metrics = await Promise.all(
      DEMO_METRICS.map(async (m) => {
        return createMetric(context, {
          ...m,
          organization: org.id,
          owner: ASSET_OWNER,
          userIdColumns: { user_id: "user_id" },
          userIdTypes: ["user_id"],
          datasource: datasource.id,
          projects: [project.id],
          tags: DEMO_TAGS,
        });
      }),
    );

    const denominatorMetricId = metrics.find(
      (m) => m.name === DENOMINATOR_METRIC_NAME,
    )?.id;
    const ratioMetric = denominatorMetricId
      ? await createMetric(context, {
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

    const goalMetrics = metrics.slice(0, 1).map((m) => m.id);

    const secondaryMetrics = metrics
      .slice(1, undefined)
      .map((m) => m.id)
      .concat(ratioMetric ? ratioMetric?.id : []);

    // Create experiment
    const experimentStartDate = new Date();
    experimentStartDate.setDate(experimentStartDate.getDate() - 30);
    const experimentToCreate: Pick<
      ExperimentInterface,
      | "name"
      | "owner"
      | "description"
      | "datasource"
      | "goalMetrics"
      | "secondaryMetrics"
      | "project"
      | "hypothesis"
      | "exposureQueryId"
      | "status"
      | "tags"
      | "trackingKey"
      | "variations"
      | "phases"
    > = {
      name: getDemoDataSourceFeatureId(),
      trackingKey: getDemoDataSourceFeatureId(),
      description: `**THIS IS A DEMO EXPERIMENT USED FOR DEMONSTRATION PURPOSES ONLY**

Experiment to test impact of checkout cart design.
Both variations move the "Proceed to checkout" button to a single table, but with different
spacing and headings.`,
      hypothesis: `We predict new variations will increase Purchase metrics and have uncertain effects on Retention.`,
      owner: ASSET_OWNER,
      datasource: datasource.id,
      project: project.id,
      goalMetrics,
      secondaryMetrics,
      exposureQueryId: "user_id",
      status: "running",
      tags: DEMO_TAGS,
      variations: [
        {
          id: "v0",
          key: "0",
          name: "Current",
          screenshots: [
            {
              path: "/images/demo-datasource/current.png",
            },
          ],
        },
        {
          id: "v1",
          key: "1",
          name: "Dev-Compact",
          screenshots: [
            {
              path: "/images/demo-datasource/dev-compact.png",
            },
          ],
        },
        {
          id: "v2",
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
          dateStarted: experimentStartDate,
          name: "",
          reason: "",
          coverage: 1,
          condition: "",
          namespace: { enabled: false, name: "", range: [0, 1] },
          variationWeights: [0.3334, 0.3333, 0.3333],
        },
      ],
    };

    const createdExperiment = await createExperiment({
      data: experimentToCreate,
      context,
    });

    // Create feature
    const featureToCreate: FeatureInterface = {
      id: getDemoDataSourceFeatureId(),
      version: 1,
      project: project.id,
      organization: org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description:
        "Controls checkout layout UI. Employees forced to see new UI, other users randomly assigned to one of three designs.",
      owner: ASSET_OWNER,
      valueType: "string",
      defaultValue: "current",
      tags: DEMO_TAGS,
      environmentSettings: {},
    };

    environments.forEach((env) => {
      featureToCreate.environmentSettings[env] = {
        enabled: true,
        rules: [
          {
            type: "force",
            description: "",
            id: `${getDemoDataSourceFeatureId()}-employee-force-rule`,
            value: "dev",
            condition: `{"is_employee":true}`,
            enabled: true,
          },
          {
            type: "experiment-ref",
            description: "",
            id: `${getDemoDataSourceFeatureId()}-exp-rule`,
            enabled: true,
            experimentId: getDemoDataSourceFeatureId(), // This value is replaced below after the experiment is created.
            variations: [
              {
                variationId: "v0",
                value: "current",
              },
              {
                variationId: "v1",
                value: "dev-compact",
              },
              {
                variationId: "v2",
                value: "dev",
              },
            ],
          },
        ],
      };

      featureToCreate.environmentSettings[env].rules.forEach((rule) => {
        if (rule.type === "experiment-ref") {
          (rule as ExperimentRefRule).experimentId = createdExperiment.id;
        }
      });
    });

    await createFeature(context, featureToCreate);

    const analysisSettings: ExperimentSnapshotAnalysisSettings = {
      statsEngine: org.settings?.statsEngine || DEFAULT_STATS_ENGINE,
      differenceType: "relative",
      dimensions: [],
      pValueThreshold:
        org.settings?.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
      numGoalMetrics: goalMetrics.length,
    };

    const metricMap = await getMetricMap(context);
    const factTableMap = await getFactTableMap(context);

    await createSnapshot({
      experiment: createdExperiment,
      context,
      phaseIndex: 0,
      defaultAnalysisSettings: analysisSettings,
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: metricMap,
      factTableMap,
      useCache: true,
      type: "standard",
      triggeredBy: "manual",
    });

    res.status(200).json({
      status: 200,
      project: project,
      experimentId: createdExperiment.id,
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
