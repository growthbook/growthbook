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
} from "shared/enterprise";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";

import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";

import { ExperimentInterface } from "back-end/types/experiment";
import { ReqContext } from "back-end/types/organization";

import { MetricSnapshotSettings } from "back-end/types/report";

import { FactTableMap } from "back-end/src/models/FactTableModel";
import { StatsEngine } from "back-end/types/stats";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourcesByIds } from "back-end/src/models/DataSourceModel";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  MetricExplorerBlockInterface,
  SqlExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
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

  // Can group and dedupe across dashboards because they won't be modified directly here, instead
  // the snapshot model will update the blocks' snapshotId field after completion
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

  await updateDashboardSavedQueries(context, { blocks: allBlocks });
}

export async function updateNonExperimentDashboard(
  context: ReqContext | ApiReqContext,
  dashboard: DashboardInterface,
) {
  const metricAnalyses = await context.models.metricAnalysis.getByIds([
    ...new Set(
      dashboard.blocks
        .filter(
          (block) =>
            blockHasFieldOfType(block, "metricAnalysisId", isString) &&
            block.metricAnalysisId.length > 0,
        )
        .map((block: MetricExplorerBlockInterface) => block.metricAnalysisId),
    ),
  ]);
  // Copy the blocks of the dashboard to overwrite their fields
  const newBlocks = dashboard.blocks.map((block) => ({ ...block }));
  for (const metricAnalysis of metricAnalyses) {
    // TODO: safety checks before refreshing
    const metric = await context.models.factMetrics.getById(
      metricAnalysis.metric,
    );
    if (metric) {
      const queryRunner = await createMetricAnalysis(
        context,
        metric,
        metricAnalysis.settings,
        metricAnalysis.source ?? "metric",
        false,
      );
      newBlocks.forEach((block) => {
        if (
          blockHasFieldOfType(block, "metricAnalysisId", isString) &&
          block.metricAnalysisId === metricAnalysis.id
        ) {
          block.metricAnalysisId = queryRunner.model.id;
        }
      });
    }
  }
  await updateDashboardSavedQueries(context, dashboard);
  await context.models.dashboards.update(dashboard, {
    blocks: newBlocks,
    nextUpdate:
      determineNextDate(context.org.settings?.updateSchedule || null) ??
      undefined,
    lastUpdated: new Date(),
  });
}

export async function updateDashboardSavedQueries(
  context: ReqContext | ApiReqContext,
  dashboard: Pick<DashboardInterface, "blocks">,
) {
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      dashboard.blocks
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
