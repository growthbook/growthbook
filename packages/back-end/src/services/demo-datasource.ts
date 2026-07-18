import {
  DEMO_DATASOURCE_HOST,
  DEMO_DATASOURCE_ID,
  DEMO_EXPERIMENT_ID,
  DEMO_EXPERIMENT_TRACKING_KEY,
  DEMO_FACT_METRIC_IDS,
  DEMO_FACT_TABLE_IDS,
  getDemoDataSourceFeatureId,
  getDemoDatasourceProjectIdForOrganization,
  getDemoResourceIds,
  getLegacyDemoFactTableIds,
} from "shared/demo-datasource";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ProjectInterface } from "shared/types/project";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import {
  FactMetricInterface,
  MetricWindowSettings,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import {
  createDataSource,
  deleteDatasource,
  getDataSourceById,
  getDataSourcesByOrganization,
} from "back-end/src/models/DataSourceModel";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import {
  createSnapshot,
  getDefaultExperimentAnalysisSettings,
} from "back-end/src/services/experiments";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  deleteMetricById,
  getMetricMap,
  getMetricsByDatasource,
} from "back-end/src/models/MetricModel";
import {
  createFeature,
  deleteFeature,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  createFactTable,
  deleteFactTable,
  getFactTable,
  getFactTableMap,
  getFactTablesForDatasource,
} from "back-end/src/models/FactTableModel";
import {
  deleteDimensionById,
  findDimensionsByDataSource,
} from "back-end/src/models/DimensionModel";
import {
  deleteAllSnapshotsForExperiment,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";

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
  "id" | "name" | "description" | "metricType" | "numerator" | "windowSettings"
>[] = [
  {
    id: DEMO_FACT_METRIC_IDS.revenuePerUser,
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
    id: DEMO_FACT_METRIC_IDS.anyPurchases,
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
    id: DEMO_FACT_METRIC_IDS.d7PurchaseRetention,
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
  | "id"
  | "name"
  | "description"
  | "metricType"
  | "numerator"
  | "denominator"
  | "windowSettings"
> = {
  id: DEMO_FACT_METRIC_IDS.averageOrderValue,
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

const DEMO_FACT_METRIC_DEFAULTS: Pick<
  FactMetricInterface,
  | "winRisk"
  | "loseRisk"
  | "regressionAdjustmentOverride"
  | "regressionAdjustmentEnabled"
  | "metricAutoSlices"
  | "cappingSettings"
  | "priorSettings"
  | "maxPercentChange"
  | "minPercentChange"
  | "minSampleSize"
  | "targetMDE"
  | "regressionAdjustmentDays"
  | "quantileSettings"
> = {
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
};

// endregion Constants for Demo Datasource

async function ensureDemoProject(
  context: ReqContext,
): Promise<ProjectInterface> {
  const demoProjId = getDemoDatasourceProjectIdForOrganization(context.org.id);
  const existing = await context.models.projects.getById(demoProjId);
  if (existing) return existing;

  return context.models.projects.create({
    id: demoProjId,
    name: "Sample Data",
  });
}

async function ensureDemoDatasource(
  context: ReqContext,
  project: ProjectInterface,
): Promise<DataSourceInterface> {
  const existing = await getDataSourceById(context, DEMO_DATASOURCE_ID);
  if (existing) return existing;

  return createDataSource(
    context,
    "Sample Data Source",
    DATASOURCE_TYPE,
    DEMO_DATASOURCE_PARAMS,
    DEMO_DATASOURCE_SETTINGS,
    DEMO_DATASOURCE_ID,
    "",
    [project.id],
  );
}

async function ensureDemoFactTables(
  context: ReqContext,
  project: ProjectInterface,
  datasource: DataSourceInterface,
): Promise<void> {
  const demoFactTableId = DEMO_FACT_TABLE_IDS.purchases;
  const demoPageViewsFactTableId = DEMO_FACT_TABLE_IDS.pageViews;

  if (!(await getFactTable(context, demoFactTableId))) {
    const demoFactTable = await createFactTable(context, {
      id: demoFactTableId,
      name: "Purchases",
      description: "",
      owner: context.userId,
      tags: DEMO_TAGS,
      userIdTypes: ["user_id"],
      sql: "SELECT\nuserId AS user_id,\ntimestamp AS timestamp,\namount AS value,\nbrowser,\ncountry\nFROM purchases",
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
        {
          column: "browser",
          datatype: "string",
        },
        {
          column: "country",
          datatype: "string",
        },
      ],
      columnRefreshPending: true,
    });

    // Kick off a column refresh so string columns get topValues populated
    // for autocomplete dropdowns in filters and Group By.
    await queueFactTableColumnsRefresh(demoFactTable);
  }

  if (!(await getFactTable(context, demoPageViewsFactTableId))) {
    const demoPageViewsFactTable = await createFactTable(context, {
      id: demoPageViewsFactTableId,
      name: "Page Views",
      description: "",
      owner: context.userId,
      tags: DEMO_TAGS,
      userIdTypes: ["user_id"],
      sql: "SELECT\nuserId AS user_id,\ntimestamp,\nbrowser,\ncountry,\npath\nFROM pages",
      eventName: "page_views",
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
          column: "browser",
          datatype: "string",
        },
        {
          column: "country",
          datatype: "string",
        },
        {
          column: "path",
          datatype: "string",
          alwaysInlineFilter: true,
        },
      ],
      columnRefreshPending: true,
    });

    await queueFactTableColumnsRefresh(demoPageViewsFactTable);
  }
}

async function ensureDemoFactMetrics(
  context: ReqContext,
  project: ProjectInterface,
  datasource: DataSourceInterface,
): Promise<void> {
  const demoFactTableId = DEMO_FACT_TABLE_IDS.purchases;

  for (const m of DEMO_METRICS) {
    if (await context.models.factMetrics.getById(m.id)) continue;
    await context.models.factMetrics.create({
      ...m,
      owner: context.userId,
      datasource: datasource.id,
      projects: [project.id],
      tags: DEMO_TAGS,
      inverse: false,
      numerator: {
        ...m.numerator,
        factTableId: demoFactTableId,
      },
      denominator: null,
      ...DEMO_FACT_METRIC_DEFAULTS,
    });
  }

  if (!(await context.models.factMetrics.getById(DEMO_RATIO_METRIC.id))) {
    await context.models.factMetrics.create({
      ...DEMO_RATIO_METRIC,
      owner: context.userId,
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
      ...DEMO_FACT_METRIC_DEFAULTS,
    });
  }
}

async function ensureDemoExperiment(
  context: ReqContext,
  project: ProjectInterface,
  datasource: DataSourceInterface,
): Promise<{ experiment: ExperimentInterface; created: boolean }> {
  const existing = await getExperimentById(context, DEMO_EXPERIMENT_ID);
  if (existing) return { experiment: existing, created: false };

  const experimentStartDate = new Date();
  experimentStartDate.setDate(experimentStartDate.getDate() - 30);
  const experimentToCreate: Pick<
    ExperimentInterface,
    | "id"
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
    | "regressionAdjustmentEnabled"
  > = {
    id: DEMO_EXPERIMENT_ID,
    name: DEMO_EXPERIMENT_TRACKING_KEY,
    trackingKey: DEMO_EXPERIMENT_TRACKING_KEY,
    description: `Experiment to test impact of a different 'Add to Cart' CTA design.
Treatment shows a larger 'Add to Cart' CTA, but with the same functionality.`,
    hypothesis: `We predict the treatment will increase Purchase metrics and have uncertain effects on Retention.`,
    owner: context.userId,
    datasource: datasource.id,
    project: project.id,
    goalMetrics: [DEMO_FACT_METRIC_IDS.revenuePerUser],
    secondaryMetrics: [
      DEMO_FACT_METRIC_IDS.anyPurchases,
      DEMO_FACT_METRIC_IDS.d7PurchaseRetention,
      DEMO_FACT_METRIC_IDS.averageOrderValue,
    ],
    exposureQueryId: "user_id",
    status: "running",
    tags: DEMO_TAGS,
    regressionAdjustmentEnabled: true,
    variations: [
      {
        id: "var_0",
        key: "0",
        name: "Control",
        screenshots: [
          {
            path: "/images/demo-datasource/add-to-cart-control.png",
          },
        ],
      },
      {
        id: "var_1",
        key: "1",
        name: "Treatment",
        screenshots: [
          {
            path: "/images/demo-datasource/add-to-cart-treatment.png",
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
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "var_0", status: "active" as const },
          { id: "var_1", status: "active" as const },
        ],
      },
    ],
  };

  const experiment = await createExperiment({
    data: experimentToCreate,
    context,
  });
  return { experiment, created: true };
}

async function ensureDemoFeature(
  context: ReqContext,
  project: ProjectInterface,
  experiment: ExperimentInterface,
): Promise<void> {
  if (await getFeature(context, getDemoDataSourceFeatureId())) return;

  const { org } = context;
  const featureToCreate: FeatureInterface = {
    id: getDemoDataSourceFeatureId(),
    version: 1,
    project: project.id,
    organization: org.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description:
      "Controls add to cart CTA. Employees forced to see new CTA, other users randomly assigned to either the control or treatment.",
    owner: context.userId,
    valueType: "boolean",
    defaultValue: "false",
    tags: DEMO_TAGS,
    environmentSettings: {},
    rules: [],
  };

  // Skip envs scoped to other projects — they'd leave unreachable rules.
  const applicableEnvs = getApplicableEnvIds(getEnvironments(org), project.id);
  applicableEnvs.forEach((env) => {
    featureToCreate.environmentSettings[env] = {
      enabled: true,
    };
  });
  // Single rules array tagged for all environments — avoids per-env duplicates.
  featureToCreate.rules.push(
    {
      type: "force",
      description: "",
      id: `${getDemoDataSourceFeatureId()}-employee-force-rule`,
      allEnvironments: true,
      environments: [],
      value: "true",
      condition: `{"is_employee":true}`,
      enabled: true,
    },
    {
      type: "experiment-ref",
      description: "",
      id: `${getDemoDataSourceFeatureId()}-exp-rule`,
      allEnvironments: true,
      environments: [],
      enabled: true,
      experimentId: experiment.id,
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
  );

  await createFeature(context, featureToCreate);
}

async function ensureDemoSnapshot(
  context: ReqContext,
  project: ProjectInterface,
  experiment: ExperimentInterface,
  experimentJustCreated: boolean,
): Promise<void> {
  if (!experimentJustCreated) {
    const existing = await getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase: 0,
      type: "standard",
    });
    if (existing) return;
  }

  const { org } = context;

  // Use the same helper the runtime uses so the snapshot's analysis
  // settings line up with what the front-end will compute when checking
  // for stale results — otherwise the experiment shows as "Outdated"
  // immediately after creation.
  const { settings: scopedSettings } = getScopedSettings({
    organization: org,
    project,
    experiment,
  });
  const analysisSettings: ExperimentSnapshotAnalysisSettings =
    getDefaultExperimentAnalysisSettings({
      statsEngine: org.settings?.statsEngine || DEFAULT_STATS_ENGINE,
      experiment,
      organization: org,
      regressionAdjustmentEnabled: experiment.regressionAdjustmentEnabled,
      postStratificationEnabled: scopedSettings.postStratificationEnabled.value,
      pValueThreshold: scopedSettings.pValueThreshold.value,
    });

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  await createSnapshot({
    experiment,
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
}

/**
 * Create any seeded sample resources that don't already exist. Safe to run
 * repeatedly — a partial seed (e.g. from a mid-seed crash) is healed on the
 * next run.
 */
export async function seedDemoResources(
  context: ReqContext,
): Promise<{ project: ProjectInterface; experiment: ExperimentInterface }> {
  const project = await ensureDemoProject(context);
  const datasource = await ensureDemoDatasource(context, project);
  await ensureDemoFactTables(context, project, datasource);
  await ensureDemoFactMetrics(context, project, datasource);
  const { experiment, created } = await ensureDemoExperiment(
    context,
    project,
    datasource,
  );
  await ensureDemoFeature(context, project, experiment);
  await ensureDemoSnapshot(context, project, experiment, created);
  return { project, experiment };
}

/**
 * Orgs seeded before resources had constant IDs can't be healed or precisely
 * deleted — their datasource/experiment/metric IDs are random. Detect them so
 * seeding keeps today's return-existing behavior instead of creating
 * duplicates alongside the legacy copies.
 */
export async function isLegacyDemoSeed(context: ReqContext): Promise<boolean> {
  const [datasource, experiment] = await Promise.all([
    getDataSourceById(context, DEMO_DATASOURCE_ID),
    getExperimentById(context, DEMO_EXPERIMENT_ID),
  ]);
  return !datasource && !experiment;
}

/**
 * Delete exactly the seeded sample resources, identified by their constant
 * IDs. Used by reset so user-created resources on the sample Data Source are
 * left alone. Missing resources are skipped.
 */
export async function deleteDemoResources(context: ReqContext): Promise<void> {
  const ids = getDemoResourceIds(context.org.id);

  const feature = await getFeature(context, ids.featureId);
  if (feature) {
    await deleteFeature(context, feature);
  }

  await deleteAllSnapshotsForExperiment(context, ids.experimentId);
  const experiment = await getExperimentById(context, ids.experimentId);
  if (experiment) {
    await deleteExperimentByIdForOrganization(context, experiment);
  }

  for (const factMetricId of ids.factMetricIds) {
    if (await context.models.factMetrics.getById(factMetricId)) {
      await context.models.factMetrics.deleteById(factMetricId);
    }
  }

  for (const factTableId of [
    ...ids.factTableIds,
    ...getLegacyDemoFactTableIds(context.org.id),
  ]) {
    const factTable = await getFactTable(context, factTableId);
    if (factTable) {
      await deleteFactTable(context, factTable);
    }
  }

  const datasource = await getDataSourceById(context, ids.datasourceId);
  if (datasource) {
    await deleteDatasource(context, datasource);
  }
}

/**
 * Sample Data Sources are identified by the constant ID, or — for orgs seeded
 * before constant IDs — by the shared sample-data postgres host restricted to
 * the Sample Data project.
 */
async function getSampleDatasourceIds(context: ReqContext): Promise<string[]> {
  const ids = new Set<string>();
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    context.org.id,
  );

  if (await getDataSourceById(context, DEMO_DATASOURCE_ID)) {
    ids.add(DEMO_DATASOURCE_ID);
  }

  const datasources = await getDataSourcesByOrganization(context);
  for (const datasource of datasources) {
    if (datasource.type !== "postgres") continue;
    if (!datasource.projects?.includes(demoProjectId)) continue;
    try {
      const params = decryptDataSourceParams<PostgresConnectionParams>(
        datasource.params,
      );
      if (params.host === DEMO_DATASOURCE_HOST) {
        ids.add(datasource.id);
      }
    } catch {
      // Ignore datasources whose credentials can't be decrypted.
    }
  }

  return [...ids];
}

async function deleteResourcesForDatasource(
  context: ReqContext,
  datasourceId: string,
): Promise<void> {
  const experiments = await getAllExperiments(context, {
    datasourceId,
    includeArchived: true,
  });
  for (const experiment of experiments) {
    await deleteAllSnapshotsForExperiment(context, experiment.id);
    await deleteExperimentByIdForOrganization(context, experiment);
  }

  const metricGroups = (await context.models.metricGroups.getAll()).filter(
    (metricGroup) => metricGroup.datasource === datasourceId,
  );
  for (const metricGroup of metricGroups) {
    await context.models.metricGroups.delete(metricGroup);
  }

  const factMetrics = await context.models.factMetrics.getAllSorted({
    datasourceId,
  });
  for (const factMetric of factMetrics) {
    await context.models.factMetrics.delete(factMetric);
  }

  // Pre-fact-metric sample seeds created legacy SQL metrics on the same DS.
  const legacyMetrics = await getMetricsByDatasource(context, datasourceId);
  for (const metric of legacyMetrics) {
    await deleteMetricById(context, metric);
  }

  const segments = await context.models.segments.getByDataSource(datasourceId);
  for (const segment of segments) {
    await context.models.segments.delete(segment);
  }

  const dimensions = await findDimensionsByDataSource(
    datasourceId,
    context.org.id,
  );
  for (const dimension of dimensions) {
    await deleteDimensionById(context, dimension);
  }

  const savedQueries = (await context.models.savedQueries.getAll()).filter(
    (savedQuery) => savedQuery.datasourceId === datasourceId,
  );
  for (const savedQuery of savedQueries) {
    await context.models.savedQueries.delete(savedQuery);
  }

  const factTables = await getFactTablesForDatasource(context, datasourceId);
  for (const factTable of factTables) {
    await deleteFactTable(context, factTable);
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (datasource) {
    await deleteDatasource(context, datasource);
  }
}

/**
 * Fully remove sample data: the seeded Feature Flag, every sample Data Source
 * (constant-ID or legacy host-matched), and resources built on those Data
 * Sources. Also removes known seed leftovers (org-derived fact tables, constant
 * fact metrics, and the demo experiment by constant ID or tracking key).
 * Resources that only reference the Sample Data project are left for
 * project-reference cleanup.
 */
export async function deleteDemoDatasourceAndDependents(
  context: ReqContext,
): Promise<void> {
  const feature = await getFeature(context, getDemoDataSourceFeatureId());
  if (feature) {
    await deleteFeature(context, feature);
  }

  const sampleDatasourceIds = await getSampleDatasourceIds(context);
  for (const datasourceId of sampleDatasourceIds) {
    await deleteResourcesForDatasource(context, datasourceId);
  }

  // Known seed IDs that may remain if a datasource was already removed, or for
  // legacy seeds whose experiment ID was random but tracking key was fixed.
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    context.org.id,
  );
  const leftoverExperiments = new Map<string, ExperimentInterface>();

  const constantExperiment = await getExperimentById(
    context,
    DEMO_EXPERIMENT_ID,
  );
  if (constantExperiment) {
    leftoverExperiments.set(constantExperiment.id, constantExperiment);
  }

  for (const experiment of await getAllExperiments(context, {
    project: demoProjectId,
    trackingKey: DEMO_EXPERIMENT_TRACKING_KEY,
    includeArchived: true,
  })) {
    leftoverExperiments.set(experiment.id, experiment);
  }

  for (const experiment of leftoverExperiments.values()) {
    await deleteAllSnapshotsForExperiment(context, experiment.id);
    await deleteExperimentByIdForOrganization(context, experiment);
  }

  for (const factMetricId of Object.values(DEMO_FACT_METRIC_IDS)) {
    if (await context.models.factMetrics.getById(factMetricId)) {
      await context.models.factMetrics.deleteById(factMetricId);
    }
  }

  for (const factTableId of [
    ...Object.values(DEMO_FACT_TABLE_IDS),
    ...getLegacyDemoFactTableIds(context.org.id),
  ]) {
    const factTable = await getFactTable(context, factTableId);
    if (factTable) {
      await deleteFactTable(context, factTable);
    }
  }
}
