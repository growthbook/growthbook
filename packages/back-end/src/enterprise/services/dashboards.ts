import { isEqual, omit, pick, uniq, uniqWith } from "lodash";
import { isDefined, isString } from "shared/util";
import {
  ExperimentMetricInterface,
  expandMetricGroups,
} from "shared/experiments";
import { getScopedSettings } from "shared/settings";
import {
  accountFeatures,
  blockHasFieldOfType,
  BlockSnapshotSettings,
  CommercialFeature,
  DashboardPublicBlockData,
  DashboardSSRData,
  getBlockAnalysisSettings,
  getBlockSnapshotAnalysis,
  getBlockSnapshotSettings,
  snapshotSatisfiesBlock,
  DashboardInterface,
  MetricExplorerBlockInterface,
  DashboardBlockInterface,
} from "shared/enterprise";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
  SavedQuery,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";

import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { FactTableInterface } from "shared/types/fact-table";
import { ProjectInterface } from "shared/types/project";
import { OrganizationSettings } from "shared/types/organization";
import { MetricSnapshotSettings } from "shared/types/report";
import { StatsEngine } from "shared/types/stats";
import {
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "shared/types/metric-analysis";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";

import { ReqContext } from "back-end/types/request";

import {
  FactTableMap,
  getFactTablesByIds,
} from "back-end/src/models/FactTableModel";
import { getMetricsByIds } from "back-end/src/models/MetricModel";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getEffectiveAccountPlan } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourcesByIds } from "back-end/src/models/DataSourceModel";
import { executeAndSaveQuery } from "back-end/src/routers/saved-queries/saved-queries.controller";
import {
  getDefaultExperimentAnalysisSettings,
  createSnapshot,
  getAdditionalExperimentAnalysisSettings,
  determineNextDate,
} from "back-end/src/services/experiments";
import { createMetricAnalysis } from "back-end/src/services/metric-analysis";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { logger } from "back-end/src/util/logger";

/**
 * Determines if nextUpdate should be recalculated based on changes to auto-updates or schedule
 */
export function shouldRecalculateNextUpdate(
  updates: {
    enableAutoUpdates?: boolean;
    updateSchedule?: DashboardInterface["updateSchedule"];
  },
  dashboard: DashboardInterface,
): boolean {
  // Auto-updates being disabled - clear nextUpdate
  if (updates.enableAutoUpdates === false) {
    return false;
  }

  // Auto-updates not enabled - no update needed
  const enableAutoUpdates =
    updates.enableAutoUpdates ?? dashboard.enableAutoUpdates;
  if (!enableAutoUpdates) {
    return false;
  }

  // Auto-updates being turned on for the first time
  if (updates.enableAutoUpdates === true && !dashboard.enableAutoUpdates) {
    return true;
  }

  // Schedule is being changed
  if (
    updates.updateSchedule &&
    !isEqual(updates.updateSchedule, dashboard.updateSchedule)
  ) {
    return true;
  }
  return false;
}

// To be run after creating the main/standard snapshot. Re-uses some of the variables for efficiency
export async function updateExperimentDashboards({
  context,
  experiment,
  mainSnapshot,
  statsEngine,
  regressionAdjustmentEnabled,
  postStratificationEnabled,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  mainSnapshot: ExperimentSnapshotInterface;
  statsEngine: StatsEngine;
  regressionAdjustmentEnabled: boolean;
  postStratificationEnabled: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}) {
  const associatedDashboards = await context.models.dashboards.findByExperiment(
    experiment.id,
    {
      enableAutoUpdates: true,
    },
  );

  // Grouping and deduping the blocks across all dashboards to run the minimum number of snapshots necessary
  const allBlocks = associatedDashboards.flatMap((dash) => dash.blocks);
  // Note: blocks for other experiments won't be updated during this flow.
  // Expected behavior is that dashboards tied to experiments don't include references to other experiments
  const blocksWithSnapshots = allBlocks
    .filter((block) => blockHasFieldOfType(block, "snapshotId", isString))
    .filter((block) => block.experimentId === experiment.id);
  const blocksNeedingSnapshot = blocksWithSnapshots.filter(
    (block) =>
      block.snapshotId.length > 0 &&
      !snapshotSatisfiesBlock(mainSnapshot, block),
  );
  const previousSnapshotIds = [
    ...new Set(blocksNeedingSnapshot.map((block) => block.snapshotId)),
  ];
  const previousSnapshots = await findSnapshotsByIds(
    context,
    previousSnapshotIds,
  );
  const previousSnapshotMap = new Map(
    previousSnapshots.map((snap) => [snap.id, snap]),
  );

  const snapshotAndAnalysisSettingPairs = blocksNeedingSnapshot.map<
    [BlockSnapshotSettings, ExperimentSnapshotAnalysisSettings]
  >((block) => {
    const blockSnapshot = previousSnapshotMap.get(block.snapshotId);
    if (!blockSnapshot)
      throw new Error(
        "Error updating dashboard results, could not find snapshot",
      );
    if (!blockSnapshot.analyses[0])
      throw new Error(
        "Error updating dashboard results, referenced snapshot missing analysis",
      );
    const defaultAnalysis = blockSnapshot.analyses[0];
    return [
      getBlockSnapshotSettings(block),
      getBlockAnalysisSettings(
        block,
        (getBlockSnapshotAnalysis(blockSnapshot, block) ?? defaultAnalysis)
          .settings,
      ),
    ];
  });

  const uniqueSnapshotSettings = uniqWith<BlockSnapshotSettings>(
    snapshotAndAnalysisSettingPairs.map(
      ([snapshotSettings]) => snapshotSettings,
    ),
    isEqual,
  );

  const dashboardProject = experiment.project
    ? ((await context.models.projects.getById(experiment.project)) ?? undefined)
    : undefined;
  const { settings: scopedDashboardSettings } = getScopedSettings({
    organization: context.org,
    project: dashboardProject,
    experiment,
  });
  const metricGroups = await context.models.metricGroups.getAll();

  for (const snapshotSettings of uniqueSnapshotSettings) {
    const additionalAnalysisSettings =
      uniqWith<ExperimentSnapshotAnalysisSettings>(
        snapshotAndAnalysisSettingPairs
          .filter(([targetSettings]) =>
            isEqual(snapshotSettings, targetSettings),
          )
          .map(([_, analysisSettings]) => analysisSettings),
        isEqual,
      );

    const analysisSettings = getDefaultExperimentAnalysisSettings({
      statsEngine,
      experiment,
      organization: context.org,
      regressionAdjustmentEnabled,
      postStratificationEnabled,
      dimension: snapshotSettings.dimensionId,
      pValueThreshold: scopedDashboardSettings.pValueThreshold.value,
      metricGroups,
    });

    const queryRunner = await createSnapshot({
      experiment,
      context,
      phaseIndex: experiment.phases.length - 1,
      defaultAnalysisSettings: analysisSettings,
      additionalAnalysisSettings: getAdditionalExperimentAnalysisSettings(
        analysisSettings,
      ).concat(additionalAnalysisSettings),
      settingsForSnapshotMetrics: settingsForSnapshotMetrics || [],
      metricMap,
      factTableMap,
      useCache: true,
      type: "exploratory",
      triggeredBy: "update-dashboards",
    });
    await queryRunner.waitForResults();
  }

  await updateDashboardSavedQueries(context, allBlocks);
  for (const dashboard of associatedDashboards) {
    const editableBlocks = dashboard.blocks.map((block) =>
      block.type === "metric-explorer" ? { ...block } : block,
    );
    const metricAnalysesUpdated = await updateDashboardMetricAnalyses(
      context,
      editableBlocks,
    );
    const explorationsUpdated = await updateDashboardExplorations(
      context,
      editableBlocks,
    );
    if (metricAnalysesUpdated || explorationsUpdated) {
      await context.models.dashboards.dangerousUpdateBypassPermission(
        dashboard,
        { blocks: editableBlocks },
      );
    }
  }
}

export async function updateNonExperimentDashboard(
  context: ReqContext | ApiReqContext,
  dashboard: DashboardInterface,
) {
  // Copy the blocks of the dashboard to overwrite their fields
  const newBlocks = dashboard.blocks.map((block) => ({ ...block }));
  await updateDashboardMetricAnalyses(context, newBlocks);
  await updateDashboardSavedQueries(context, newBlocks);
  await updateDashboardExplorations(context, newBlocks);
  await context.models.dashboards.dangerousUpdateBypassPermission(dashboard, {
    blocks: newBlocks,
    nextUpdate:
      determineNextDate(dashboard.updateSchedule || null) ?? undefined,
    lastUpdated: new Date(),
  });
}

// Returns a boolean indicating whether the blocks have been modified and will need to be saved to db
export async function updateDashboardMetricAnalyses(
  context: ReqContext | ApiReqContext,
  blocks: DashboardInterface["blocks"],
): Promise<boolean> {
  // Filter to only blocks with metric analysis IDs
  const blocksWithMetricAnalysis = blocks.filter(
    (block): block is MetricExplorerBlockInterface =>
      blockHasFieldOfType(block, "metricAnalysisId", isString) &&
      block.metricAnalysisId.length > 0,
  );

  // Process each block individually to use its specific analysisSettings
  const results = await Promise.all(
    blocksWithMetricAnalysis.map(async (block) => {
      const metricAnalysis = await context.models.metricAnalysis.getById(
        block.metricAnalysisId,
      );

      if (!metricAnalysis) {
        return false;
      }

      const metric = await context.models.factMetrics.getById(
        metricAnalysis.metric,
      );

      if (!metric) {
        return false;
      }

      // Use the block's analysisSettings instead of the metricAnalysis.settings
      // This ensures filters and other block-specific settings are preserved
      const blockSettings = block.analysisSettings;
      // Reset the stored dates based on the configured lookback days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - blockSettings.lookbackDays);

      const settings: MetricAnalysisSettings = {
        userIdType: blockSettings.userIdType,
        lookbackDays: blockSettings.lookbackDays,
        startDate,
        endDate,
        populationType: blockSettings.populationType,
        populationId: blockSettings.populationId ?? null,
        additionalNumeratorFilters: blockSettings.additionalNumeratorFilters,
        additionalDenominatorFilters:
          blockSettings.additionalDenominatorFilters,
      };

      const queryRunner = await createMetricAnalysis(
        context,
        metric,
        settings,
        "metric",
        false,
      );

      // Mutate the block in place (same object reference as in original blocks array)
      block.metricAnalysisId = queryRunner.model.id;
      block.analysisSettings.startDate = startDate;
      block.analysisSettings.endDate = endDate;
      return true;
    }),
  );

  return results.some((updated) => updated);
}

const PRODUCT_ANALYTICS_EXPLORATION_BLOCK_TYPES = [
  "metric-exploration",
  "fact-table-exploration",
  "data-source-exploration",
] as const;

function isProductAnalyticsExplorationBlock(
  block: DashboardInterface["blocks"][number],
): block is DashboardInterface["blocks"][number] & {
  explorerAnalysisId: string;
  config: ExplorationConfig;
} {
  return (
    PRODUCT_ANALYTICS_EXPLORATION_BLOCK_TYPES.includes(
      block.type as (typeof PRODUCT_ANALYTICS_EXPLORATION_BLOCK_TYPES)[number],
    ) &&
    "explorerAnalysisId" in block &&
    typeof (block as { explorerAnalysisId?: string }).explorerAnalysisId ===
      "string" &&
    (block as { explorerAnalysisId: string }).explorerAnalysisId.length > 0 &&
    "config" in block &&
    (block as { config?: unknown }).config != null
  );
}

// Returns a boolean indicating whether the blocks have been modified and will need to be saved to db
export async function updateDashboardExplorations(
  context: ReqContext | ApiReqContext,
  blocks: DashboardInterface["blocks"],
): Promise<boolean> {
  const explorationBlocks = blocks.filter(isProductAnalyticsExplorationBlock);
  if (explorationBlocks.length === 0) return false;

  let anyUpdated = false;
  for (const block of explorationBlocks) {
    try {
      const exploration = await runProductAnalyticsExploration(
        context,
        block.config,
        { cache: "never" },
      );
      // This should never happen when cache="never", but just in case
      if (!exploration) {
        throw new Error("Failed run to run product analytics query");
      }
      block.explorerAnalysisId = exploration.id;
      anyUpdated = true;
    } catch (e) {
      logger.warn(
        { err: e, blockId: block.id, blockType: block.type },
        "Failed to refresh product analytics exploration block",
      );
    }
  }
  return anyUpdated;
}

export async function updateDashboardSavedQueries(
  context: ReqContext | ApiReqContext,
  blocks: DashboardInterface["blocks"],
) {
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      blocks
        .filter(
          (
            block,
          ): block is Extract<
            DashboardBlockInterface,
            { savedQueryId: string }
          > =>
            blockHasFieldOfType(block, "savedQueryId", isString) &&
            block.savedQueryId.length > 0,
        )
        .map((block) => block.savedQueryId),
    ),
  ]);

  const datasourceIds: string[] = [
    ...new Set<string>(savedQueries.map(({ datasourceId }) => datasourceId)),
  ];
  const datasources = await getDataSourcesByIds(context, datasourceIds);
  const datasourceMap = new Map(datasources.map((ds) => [ds.id, ds]));

  await Promise.all(
    savedQueries.map(async (savedQuery) => {
      const savedQueryDataSource = datasourceMap.get(savedQuery.datasourceId);
      if (savedQueryDataSource) {
        await executeAndSaveQuery(context, savedQuery, savedQueryDataSource);
      }
    }),
  );
}

// Org settings exposed to the public dashboard page (stat config needed to
// render results). Mirrors the allow-list used by generateExperimentReportSSRData.
const PUBLIC_SSR_SETTINGS_KEYS: Array<keyof OrganizationSettings> = [
  "confidenceLevel",
  "metricDefaults",
  "multipleExposureMinPercent",
  "statsEngine",
  "pValueThreshold",
  "pValueCorrection",
  "regressionAdjustmentEnabled",
  "regressionAdjustmentDays",
  "srmThreshold",
  "attributionModel",
  "sequentialTestingEnabled",
  "sequentialTestingTuningParameter",
  "displayCurrency",
  // Needed by ExperimentTrafficBlock's health timeseries gate on the public page.
  "runHealthTrafficQuery",
];

// Metric fields that carry query/SQL/schema details. Stripped before a metric
// is exposed to anonymous viewers. Matches generateExperimentReportSSRData.
const SENSITIVE_METRIC_FIELDS = [
  "queries",
  "runStarted",
  "analysis",
  "analysisError",
  "table",
  "column",
  "timestampColumn",
  "conditions",
  "queryFormat",
] as const;

// Builds the definitions/labels polyfill for the unauthenticated public
// dashboard page (which has no DefinitionsContext), collected across all of a
// dashboard's blocks. Values are redacted via allow-list (settings/projects)
// or by stripping sensitive fields (metrics). This is NOT block result data.
//
// NOTE: factMetricSlices is deferred (returned empty) for the first cut — it's
// a display enhancement, not a leak vector. See generateExperimentReportSSRData
// for the slice-generation logic to port if/when needed.
export async function generateDashboardSSRData({
  context,
  dashboard,
}: {
  context: ReqContext;
  dashboard: DashboardInterface;
}): Promise<DashboardSSRData> {
  const experimentIds = new Set<string>();
  const referencedMetricIds = new Set<string>();
  const dimensionIds = new Set<string>();

  for (const block of dashboard.blocks) {
    if (
      blockHasFieldOfType(block, "experimentId", isString) &&
      block.experimentId
    ) {
      experimentIds.add(block.experimentId);
    }
    if ("metricIds" in block && Array.isArray(block.metricIds)) {
      block.metricIds.forEach((id) => {
        if (id) referencedMetricIds.add(id);
      });
    }
    if (
      blockHasFieldOfType(block, "factMetricId", isString) &&
      block.factMetricId
    ) {
      referencedMetricIds.add(block.factMetricId);
    }
    if (
      blockHasFieldOfType(block, "dimensionId", isString) &&
      block.dimensionId
    ) {
      dimensionIds.add(block.dimensionId);
    }
  }

  const metricGroups = await context.models.metricGroups.getAll();
  const metricIds = expandMetricGroups([...referencedMetricIds], metricGroups);

  const metrics = await getMetricsByIds(
    context,
    metricIds.filter((m) => m.startsWith("met_")),
  );
  const factMetrics = await context.models.factMetrics.getByIds(
    metricIds.filter((m) => m.startsWith("fact__")),
  );

  // Pull in denominator metrics referenced by ratio metrics (mirrors report SSR)
  const denominatorMetricIds = uniq(
    metrics
      .map((m) => m.denominator)
      .filter((id): id is string => !!id && !metricIds.includes(id)),
  );
  const denominatorMetrics = await getMetricsByIds(
    context,
    denominatorMetricIds,
  );

  const metricMap: Record<string, ExperimentMetricInterface> = {};
  [...metrics, ...factMetrics, ...denominatorMetrics].forEach((metric) => {
    metricMap[metric.id] = omit(
      metric,
      SENSITIVE_METRIC_FIELDS,
    ) as ExperimentMetricInterface;
  });

  const factTableIds = uniq(
    factMetrics.flatMap((m) =>
      [m?.numerator?.factTableId, m?.denominator?.factTableId].filter(
        (id): id is string => !!id,
      ),
    ),
  );
  const factTables = await getFactTablesByIds(context, factTableIds);
  const factTableMap: Record<string, FactTableInterface> = {};
  factTables.forEach((ft) => {
    factTableMap[ft.id] = ft;
  });

  const allDimensions = await findDimensionsByOrganization(context.org.id);
  const dimensions = allDimensions.filter((d) => dimensionIds.has(d.id));

  // Experiments: expose only display fields, matching the public experiment page
  const experiments: Record<
    string,
    Partial<ExperimentInterfaceStringDates>
  > = {};
  const projectIds = new Set<string>(dashboard.projects ?? []);
  for (const experimentId of experimentIds) {
    const experiment = await getExperimentById(context, experimentId);
    if (!experiment) continue;
    if (experiment.project) projectIds.add(experiment.project);
    experiments[experimentId] = pick(experiment, [
      "id",
      "name",
      "type",
      "hypothesis",
      "description",
      "variations",
      "phases",
      "status",
      "project",
      // Dates (phases) are serialized to ISO strings by res.json before reaching
      // the client, matching ExperimentInterfaceStringDates on the wire.
    ]) as unknown as Partial<ExperimentInterfaceStringDates>;
  }

  const projects: Record<string, ProjectInterface> = {};
  for (const projectId of projectIds) {
    const project = await context.models.projects.getById(projectId);
    if (project) {
      projects[projectId] = pick(project, [
        "name",
        "id",
        "settings",
      ]) as ProjectInterface;
    }
  }

  const settings: OrganizationSettings = pick(
    context.org.settings,
    PUBLIC_SSR_SETTINGS_KEYS,
  );

  // Check commercial features against the org (not a user) for public pages
  const publicRelevantFeatures: CommercialFeature[] = ["metric-slices"];
  const allFeatures = accountFeatures[getEffectiveAccountPlan(context.org)];
  const commercialFeatures = publicRelevantFeatures.filter((f) =>
    allFeatures.has(f),
  );

  return {
    metrics: metricMap,
    metricGroups,
    factTables: factTableMap,
    factMetricSlices: {},
    dimensions,
    projects,
    settings,
    experiments,
    commercialFeatures,
  };
}

// ---------------------------------------------------------------------------
// Public block result data + redaction
//
// Resolves the data referenced by a public dashboard's blocks (snapshots,
// saved-query results, metric analyses, explorations) and redacts each through
// per-type serializers before it leaves for an anonymous viewer. Every fetch
// here bypasses per-resource permission checks (agenda-job context), so these
// serializers ARE the authorization boundary for block data.
// ---------------------------------------------------------------------------

// Snapshots embed raw SQL inside `settings` (metric SQL, dimension SQL, and the
// authored queryFilter). Blank those while keeping the analyses/results the UI
// renders. Targeted strip rather than a full allow-list: settings has ~40
// nested fields and allow-listing it would be brittle and break rendering. The
// `queries` field is only QueryPointer[] (id/status/name) — no SQL.
export function redactSnapshotForPublic(
  snapshot: ExperimentSnapshotInterface,
): ExperimentSnapshotInterface {
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      queryFilter: "",
      metricSettings: snapshot.settings.metricSettings.map((m) =>
        m.settings ? { ...m, settings: { ...m.settings, sql: "" } } : m,
      ),
      dimensions: snapshot.settings.dimensions.map((d) =>
        d.settings ? { ...d, settings: { ...d.settings, sql: "" } } : d,
      ),
    },
  };
}

// sql-explorer blocks: strip the raw SQL (top-level and the copy nested in
// results) and keep the result rows + viz config the author chose to display.
export function redactSavedQueryForPublic(query: SavedQuery): SavedQuery {
  return {
    ...query,
    sql: "",
    results: { ...query.results, sql: undefined },
  };
}

// Metric analyses carry no inline SQL, but settings can hold adhoc SQL filter
// expressions — strip those; keep the result + display settings.
export function redactMetricAnalysisForPublic(
  analysis: MetricAnalysisInterface,
): MetricAnalysisInterface {
  return {
    ...analysis,
    settings: {
      ...analysis.settings,
      additionalNumeratorFilters: undefined,
      additionalDenominatorFilters: undefined,
    },
  };
}

// Explorations are structured builder specs (no raw SQL, no credentials;
// datasource is an id) that the author intentionally publishes, so config +
// result are returned as-is. NOTE: this does expose the analytics query
// structure (dimensions, filter values). Tighten here if that's not desired.
export function redactExplorationForPublic(
  exploration: ProductAnalyticsExploration,
): ProductAnalyticsExploration {
  return exploration;
}

export async function getPublicDashboardBlockData({
  context,
  dashboard,
}: {
  context: ReqContext;
  dashboard: DashboardInterface;
}): Promise<DashboardPublicBlockData> {
  // Snapshots only exist for experiment dashboards
  let snapshots: ExperimentSnapshotInterface[] = [];
  if (dashboard.experimentId) {
    const experiment = await getExperimentById(context, dashboard.experimentId);
    const snapshotIds = [
      ...new Set([
        experiment?.analysisSummary?.snapshotId,
        ...dashboard.blocks.map((block) => block.snapshotId),
      ]),
    ].filter((id): id is string => isDefined(id) && id.length > 0);
    snapshots = await findSnapshotsByIds(context, snapshotIds);
  }

  const savedQueryIds = [
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block,
          ): block is Extract<
            DashboardBlockInterface,
            { savedQueryId: string }
          > =>
            blockHasFieldOfType(block, "savedQueryId", isString) &&
            block.savedQueryId.length > 0,
        )
        .map((block) => block.savedQueryId),
    ),
  ];
  const savedQueries =
    await context.models.savedQueries.getByIds(savedQueryIds);

  const metricAnalysisIds = [
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block,
          ): block is Extract<
            DashboardBlockInterface,
            { metricAnalysisId: string }
          > =>
            blockHasFieldOfType(block, "metricAnalysisId", isString) &&
            block.metricAnalysisId.length > 0,
        )
        .map((block) => block.metricAnalysisId),
    ),
  ];
  const metricAnalyses =
    await context.models.metricAnalysis.getByIds(metricAnalysisIds);

  const explorerAnalysisIds = [
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block,
          ): block is DashboardBlockInterface & {
            explorerAnalysisId: string;
          } =>
            (block.type === "metric-exploration" ||
              block.type === "fact-table-exploration" ||
              block.type === "data-source-exploration") &&
            "explorerAnalysisId" in block &&
            typeof (block as { explorerAnalysisId?: string })
              .explorerAnalysisId === "string" &&
            (block as { explorerAnalysisId: string }).explorerAnalysisId
              .length > 0,
        )
        .map((block) => block.explorerAnalysisId),
    ),
  ];
  const explorations: ProductAnalyticsExploration[] =
    explorerAnalysisIds.length > 0
      ? (
          await context.models.analyticsExplorations.getByIds(
            explorerAnalysisIds,
          )
        ).filter((e): e is ProductAnalyticsExploration => e != null)
      : [];

  return {
    snapshots: snapshots.map(redactSnapshotForPublic),
    savedQueries: savedQueries.map(redactSavedQueryForPublic),
    metricAnalyses: metricAnalyses.map(redactMetricAnalysisForPublic),
    explorations: explorations.map(redactExplorationForPublic),
  };
}
