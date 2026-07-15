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
  resolveExperimentBlockMetricIds,
  getEffectiveExplorationConfig,
  snapshotSatisfiesBlock,
  DashboardInterface,
  MetricExplorerBlockInterface,
  DashboardBlockInterface,
  resolveBlockComparison,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { ProductAnalyticsExploration, SavedQuery } from "shared/validators";
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
      dashboard,
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
  await updateDashboardExplorations(context, newBlocks, dashboard);
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

      // Keep the compare-to-previous-period analysis in sync with the rolled
      // window. The previous window is derived (never reserved) — an adjacent
      // window of equal length immediately preceding the current one — so it
      // rolls alongside the primary on every manual/scheduled refresh. Resolved
      // through the shared seam so a future dashboard-wide compare toggle drives
      // this the same way the per-block setting does.
      //
      // COST NOTE / revisit: this runs a second metric analysis per
      // compare-enabled block, so a dashboard with N such blocks issues up to 2N
      // analyses per refresh cycle. Fine today (they run concurrently via the
      // Promise.all below), but if query costs run up — e.g. dashboards with many
      // metric blocks on a tight updateSchedule — consider batching the current
      // and previous windows into a single analysis/query instead of two.
      if (resolveBlockComparison(block)?.enabled) {
        const spanMs = endDate.getTime() - startDate.getTime();
        const comparisonSettings: MetricAnalysisSettings = {
          ...settings,
          startDate: new Date(startDate.getTime() - spanMs),
          endDate: startDate,
        };
        const comparisonQueryRunner = await createMetricAnalysis(
          context,
          metric,
          comparisonSettings,
          "metric",
          false,
        );
        block.comparisonMetricAnalysisId = comparisonQueryRunner.model.id;
      }

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

type ProductAnalyticsExplorationBlock = Extract<
  DashboardInterface["blocks"][number],
  { type: (typeof PRODUCT_ANALYTICS_EXPLORATION_BLOCK_TYPES)[number] }
>;

function isProductAnalyticsExplorationBlock(
  block: DashboardInterface["blocks"][number],
): block is ProductAnalyticsExplorationBlock {
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
  // Optional so the future dashboard-wide compare toggle can drive every block
  // through resolveBlockComparison without changing this signature again.
  dashboard?: Pick<DashboardInterface, "globalControls" | "comparison">,
): Promise<boolean> {
  const explorationBlocks = blocks.filter(isProductAnalyticsExplorationBlock);
  if (explorationBlocks.length === 0) return false;

  let anyUpdated = false;
  for (const block of explorationBlocks) {
    try {
      // Re-resolve the comparison every refresh so predefined previous windows
      // roll forward with the primary range (custom windows stay fixed).
      const comparison = resolveBlockComparison(block, dashboard);
      const primaryConfig = dashboard
        ? getEffectiveExplorationConfig(block, dashboard)
        : block.config;
      // allSettled (not all): a comparison failure (timeout, upstream schema
      // change, transient warehouse issue) must not block the primary refresh
      // and leave the whole block frozen at its last refresh.
      const [primaryResult, comparisonResult] = await Promise.allSettled([
        runProductAnalyticsExploration(context, primaryConfig, {
          cache: "never",
        }),
        comparison
          ? runProductAnalyticsExploration(
              context,
              {
                ...primaryConfig,
                dateRange: resolveComparisonPreviousTimeFrame(
                  primaryConfig.dateRange,
                  comparison,
                ),
              },
              { cache: "never" },
            )
          : Promise.resolve(null),
      ]);
      if (primaryResult.status === "rejected") {
        throw primaryResult.reason;
      }
      // This should never happen when cache="never", but just in case
      if (!primaryResult.value) {
        throw new Error("Failed run to run product analytics query");
      }
      block.explorerAnalysisId = primaryResult.value.id;
      if (comparisonResult.status === "fulfilled") {
        if (comparisonResult.value) {
          block.comparisonExplorerAnalysisId = comparisonResult.value.id;
        } else {
          // Clear a stale comparison id when comparison is off.
          delete block.comparisonExplorerAnalysisId;
        }
      } else {
        // Keep the previous comparison id so the primary still refreshes.
        logger.warn(
          {
            err: comparisonResult.reason,
            blockId: block.id,
            blockType: block.type,
          },
          "Failed to refresh product analytics comparison; keeping previous comparison",
        );
      }
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
  "runHealthTrafficQuery",
];

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
  // These metrics are exposed without their Fact Tables to avoid leaking SQL.
  const explorationFactMetricIds = new Set<string>();

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
    if (block.type === "metric-exploration") {
      block.config?.dataset?.values?.forEach((v) => {
        if (v?.metricId) explorationFactMetricIds.add(v.metricId);
      });
    }
  }

  const metricGroups = await context.models.metricGroups.getAll();

  const experimentsById = new Map<string, ExperimentInterface>();
  for (const experimentId of experimentIds) {
    const experiment = await getExperimentById(context, experimentId);
    if (experiment) experimentsById.set(experimentId, experiment);
  }

  for (const block of dashboard.blocks) {
    if (
      "metricIds" in block &&
      Array.isArray(block.metricIds) &&
      blockHasFieldOfType(block, "experimentId", isString)
    ) {
      resolveExperimentBlockMetricIds({
        blockMetricIds: block.metricIds,
        experiment: experimentsById.get(block.experimentId),
        metricGroups,
      }).forEach((id) => referencedMetricIds.add(id));
    }
  }

  const metricIds = expandMetricGroups([...referencedMetricIds], metricGroups);

  const metrics = await getMetricsByIds(
    context,
    metricIds.filter((m) => m.startsWith("met_")),
  );
  const factMetrics = await context.models.factMetrics.getByIds(
    metricIds.filter((m) => m.startsWith("fact__")),
  );

  const denominatorMetricIds = uniq(
    metrics
      .map((m) => m.denominator)
      .filter((id): id is string => !!id && !metricIds.includes(id)),
  );
  const denominatorMetrics = await getMetricsByIds(
    context,
    denominatorMetricIds,
  );

  // Do not include the Fact Tables for exploration-only metrics.
  const explorationOnlyFactMetricIds = [...explorationFactMetricIds].filter(
    (id) => !metricIds.includes(id),
  );
  const explorationFactMetrics = await context.models.factMetrics.getByIds(
    explorationOnlyFactMetricIds,
  );

  const metricMap: Record<string, ExperimentMetricInterface> = {};
  [
    ...metrics,
    ...factMetrics,
    ...denominatorMetrics,
    ...explorationFactMetrics,
  ].forEach((metric) => {
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

  const experiments: Record<
    string,
    Partial<ExperimentInterfaceStringDates>
  > = {};
  const projectIds = new Set<string>(dashboard.projects ?? []);
  for (const [experimentId, experiment] of experimentsById) {
    if (experiment.project) projectIds.add(experiment.project);
    // Express serializes the dates before this reaches the client.
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
      "goalMetrics",
      "secondaryMetrics",
      "guardrailMetrics",
      "metricOverrides",
      "customMetricSlices",
      "analysisSummary",
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

// These serializers are the authorization boundary for anonymous block data.
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

export async function getPublicDashboardBlockData({
  context,
  dashboard,
}: {
  context: ReqContext;
  dashboard: DashboardInterface;
}): Promise<DashboardPublicBlockData> {
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
            blockHasFieldOfType(block, "explorerAnalysisId", isString) &&
            block.explorerAnalysisId.length > 0,
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
    explorations,
  };
}
