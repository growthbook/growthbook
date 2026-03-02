import type { Response } from "express";
import {
  getDemoDatasourceFactTableIdForOrganization,
  getDemoDataSourceFeatureId,
  getDemoDatasourceProjectIdForOrganization,
} from "shared/demo-datasource";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { DataSourceSettings } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentRefRule, FeatureInterface } from "shared/types/feature";
import { ProjectInterface } from "shared/types/project";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import {
  FactMetricInterface,
  MetricWindowSettings,
} from "shared/types/fact-table";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { createDataSource } from "back-end/src/models/DataSourceModel";
import {
  createExperiment,
  getAllExperiments,
} from "back-end/src/models/ExperimentModel";
import { createSnapshot } from "back-end/src/services/experiments";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { createFeature } from "back-end/src/models/FeatureModel";
import {
  createFactTable,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";

// region Constants for Demo Datasource

// Datasource constants
const DATASOURCE_TYPE = "postgres";
const DEMO_DATASOURCE_SETTINGS: DataSourceSettings = {
  userIdTypes: [{ userIdType: "user_id", description: "Logged-in user id" }],
  queries: {
    exposure: [
      {
        id: "user_id",
        name: "Logged-in User Experiments",
        userIdType: "user_id",
        query:
          "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\nexperimentId AS experiment_id,\nvariationId AS variation_id,\nbrowser\nFROM experiment_viewed",
        dimensions: ["browser"],
        dimensionMetadata: [
          {
            dimension: "browser",
            specifiedSlices: ["Chrome", "Firefox", "Safari", "Edge"],
            customSlices: true,
          },
        ],
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
const RETENTION_WINDOW_SETTINGS: MetricWindowSettings = {
  type: "",
  windowUnit: "days",
  windowValue: 7,
  delayUnit: "days",
  delayValue: 7,
};
const EMPTY_WINDOW_SETTINGS: MetricWindowSettings = {
  type: "",
  windowUnit: "days",
  windowValue: 3,
  delayUnit: "hours",
  delayValue: 0,
};
const DEMO_METRICS: Pick<
  FactMetricInterface,
  "name" | "description" | "metricType" | "numerator" | "windowSettings"
>[] = [
  {
    name: "Revenue per User",
    description: "The total amount of USD spent aggregated at the user level",
    metricType: "mean",
    numerator: {
      factTableId: "",
      column: "value",
    },
    windowSettings: EMPTY_WINDOW_SETTINGS,
  },
  {
    name: "Any Purchases",
    description: "Whether the user places any order or not (0/1)",
    metricType: "proportion",
    numerator: {
      factTableId: "",
      column: "$$distinctUsers",
    },
    windowSettings: EMPTY_WINDOW_SETTINGS,
  },
  {
    name: "D7 Purchase Retention",
    description: "",
    metricType: "retention",
    numerator: {
      factTableId: "",
      column: "$$distinctUsers",
    },
    windowSettings: RETENTION_WINDOW_SETTINGS,
  },
];

const DEMO_RATIO_METRIC: Pick<
  FactMetricInterface,
  | "name"
  | "description"
  | "metricType"
  | "numerator"
  | "denominator"
  | "windowSettings"
> = {
  name: "Average Order Value",
  description: "The average value of purchases",
  metricType: "ratio",
  numerator: {
    factTableId: "",
    column: "value",
  },
  denominator: {
    factTableId: "",
    column: "$$count",
  },
  windowSettings: EMPTY_WINDOW_SETTINGS,
};

const DEMO_DATA_EXPERIMENT_ID = "gbdemo-add-to-cart-cta";

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
  const demoFactTableId = getDemoDatasourceFactTableIdForOrganization(org.id);

  if (
    !context.permissions.canCreateFactMetric({ projects: [demoProjId] }) ||
    !context.permissions.canCreateFactTable({ projects: [demoProjId] }) ||
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

    // Create fact table
    await createFactTable(context, {
      id: demoFactTableId,
      name: "purchases",
      description: "",
      owner: ASSET_OWNER,
      tags: DEMO_TAGS,
      userIdTypes: ["user_id"],
      sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value\nFROM purchases",
      eventName: "purchases",
      datasource: datasource.id,
      projects: [project.id],
      columns: [
        {
          column: "user_id",
          datatype: "string",
        },
        {
          column: "timestamp",
          datatype: "date",
        },
        {
          column: "value",
          datatype: "number",
          numberFormat: "currency",
        },
      ],
    });

    // Create metrics
    const metrics = await Promise.all(
      DEMO_METRICS.map(async (m) => {
        return context.models.factMetrics.create({
          ...m,
          ...(m.metricType === "retention"
            ? { id: `fact__demo-d7-purchase-retention` }
            : {}),
          owner: ASSET_OWNER,
          datasource: datasource.id,
          projects: [project.id],
          tags: DEMO_TAGS,
          inverse: false,
          numerator: {
            ...m.numerator,
            factTableId: demoFactTableId,
          },
          denominator: null,
          winRisk: 0.0025,
          loseRisk: 0.0125,
          regressionAdjustmentOverride: false,
          regressionAdjustmentEnabled: false,
          metricAutoSlices: [],
          cappingSettings: {
            type: "",
            value: 0,
          },
          priorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 0.3,
          },
          maxPercentChange: 0.5,
          minPercentChange: 0.005,
          minSampleSize: 150,
          targetMDE: 0.1,
          regressionAdjustmentDays: 14,
          quantileSettings: null,
        });
      }),
    );

    const ratioMetric = await context.models.factMetrics.create({
      ...DEMO_RATIO_METRIC,
      owner: ASSET_OWNER,
      datasource: datasource.id,
      projects: [project.id],
      tags: DEMO_TAGS,
      inverse: false,
      numerator: {
        ...DEMO_RATIO_METRIC.numerator,
        factTableId: demoFactTableId,
      },
      denominator: {
        ...DEMO_RATIO_METRIC.denominator!,
        factTableId: demoFactTableId,
      },
      winRisk: 0.0025,
      loseRisk: 0.0125,
      regressionAdjustmentOverride: false,
      regressionAdjustmentEnabled: false,
      metricAutoSlices: [],
      cappingSettings: {
        type: "",
        value: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.3,
      },
      maxPercentChange: 0.5,
      minPercentChange: 0.005,
      minSampleSize: 150,
      targetMDE: 0.1,
      regressionAdjustmentDays: 14,
      quantileSettings: null,
    });

    const goalMetrics = metrics.slice(0, 1).map((m) => m.id);

    const secondaryMetrics = metrics
      .slice(1, undefined)
      .map((m) => m.id)
      .concat(ratioMetric ? ratioMetric?.id : []);

    // Create experiment
    const experimentStartDate = new Date();
    experimentStartDate.setDate(experimentStartDate.getDate() - 30);
    const demoVariations = [
      {
        id: "v0",
        key: "0",
        name: "Control",
        screenshots: [
          {
            path: "/images/demo-datasource/add-to-cart-control.png",
          },
        ],
        status: "active" as const,
      },
      {
        id: "v1",
        key: "1",
        name: "Treatment",
        screenshots: [
          {
            path: "/images/demo-datasource/add-to-cart-treatment.png",
          },
        ],
        status: "active" as const,
      },
    ];

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
      | "phases"
      | "regressionAdjustmentEnabled"
    > = {
      name: DEMO_DATA_EXPERIMENT_ID,
      trackingKey: DEMO_DATA_EXPERIMENT_ID,
      description: `**THIS IS A DEMO EXPERIMENT USED FOR DEMONSTRATION PURPOSES ONLY**

Experiment to test impact of a different 'Add to Cart' CTA design.
Treatment shows a larger 'Add to Cart' CTA, but with the same functionality.`,
      hypothesis: `We predict the treatment will increase Purchase metrics and have uncertain effects on Retention.`,
      owner: ASSET_OWNER,
      datasource: datasource.id,
      project: project.id,
      goalMetrics,
      secondaryMetrics,
      exposureQueryId: "user_id",
      status: "running",
      tags: DEMO_TAGS,
      regressionAdjustmentEnabled: true,
      phases: [
        {
          dateStarted: experimentStartDate,
          name: "",
          reason: "",
          coverage: 1,
          condition: "",
          namespace: { enabled: false, name: "", range: [0, 1] },
          variationWeights: [0.5, 0.5],
          variations: demoVariations,
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
        "Controls add to cart CTA. Employees forced to see new CTA, other users randomly assigned to either the control or treatment.",
      owner: ASSET_OWNER,
      valueType: "boolean",
      defaultValue: "false",
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
            value: "true",
            condition: `{"is_employee":true}`,
            enabled: true,
          },
          {
            type: "experiment-ref",
            description: "",
            id: `${getDemoDataSourceFeatureId()}-exp-rule`,
            enabled: true,
            experimentId: DEMO_DATA_EXPERIMENT_ID, // This value is replaced below after the experiment is created.
            variations: [
              {
                variationId: "v0",
                value: "false",
              },
              {
                variationId: "v1",
                value: "true",
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
