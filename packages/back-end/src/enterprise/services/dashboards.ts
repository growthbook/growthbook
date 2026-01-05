import { isEqual, uniqWith } from "lodash";
import { isString } from "shared/util";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  blockHasFieldOfType,
  BlockSnapshotSettings,
  getBlockAnalysisSettings,
  getBlockSnapshotAnalysis,
  getBlockSnapshotSettings,
  snapshotSatisfiesBlock,
  DashboardInterface,
  MetricExplorerBlockInterface,
  SqlExplorerBlockInterface,
} from "shared/enterprise";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";

import { ExperimentInterface } from "shared/types/experiment";
import { MetricSnapshotSettings } from "shared/types/report";
import { StatsEngine } from "shared/types/stats";
import { MetricAnalysisSettings } from "shared/types/metric-analysis";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";

import { ReqContext } from "back-end/types/request";

import { FactTableMap } from "back-end/src/models/FactTableModel";
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

// To be run after creating the main/standard snapshot. Re-uses some of the variables for efficiency
export async function updateExperimentDashboards({
  context,
  experiment,
  mainSnapshot,
  statsEngine,
  regressionAdjustmentEnabled,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  mainSnapshot: ExperimentSnapshotInterface;
  statsEngine: StatsEngine;
  regressionAdjustmentEnabled: boolean;
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

    const analysisSettings = getDefaultExperimentAnalysisSettings(
      statsEngine,
      experiment,
      context.org,
      regressionAdjustmentEnabled,
      snapshotSettings.dimensionId,
    );

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
    const blockUpdated = await updateDashboardMetricAnalyses(
      context,
      editableBlocks,
    );
    if (blockUpdated) {
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
        metricAutoSlices: blockSettings.metricAutoSlices,
        customMetricSlices: blockSettings.customMetricSlices,
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

export async function updateDashboardSavedQueries(
  context: ReqContext | ApiReqContext,
  blocks: DashboardInterface["blocks"],
) {
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      blocks
        .filter((block) => block.type === "sql-explorer" && block.savedQueryId)
        .map((block: SqlExplorerBlockInterface) => block.savedQueryId!),
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
