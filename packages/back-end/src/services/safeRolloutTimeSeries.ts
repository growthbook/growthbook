import md5 from "md5";
import { isFactMetricId, expandMetricGroups } from "shared/experiments";
import { SAFE_ROLLOUT_VARIATIONS } from "shared/constants";
import {
  CreateMetricTimeSeriesSingleDataPoint,
  MetricTimeSeriesValue,
  MetricTimeSeriesVariation,
} from "shared/src/validators/metric-time-series";
import { ReqContext } from "back-end/types/organization";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import {
  SafeRolloutSnapshotInterface,
  SafeRolloutSnapshotSettings,
  MetricForSafeRolloutSnapshot,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotMetricInterface,
} from "back-end/src/validators/safe-rollout-snapshot";
import { logger } from "back-end/src/util/logger";

export async function updateSafeRolloutTimeSeries({
  context,
  safeRollout,
  safeRolloutSnapshot,
  notificationTriggered,
}: {
  context: ReqContext;
  safeRollout: SafeRolloutInterface;
  safeRolloutSnapshot: SafeRolloutSnapshotInterface;
  notificationTriggered: boolean;
}) {
  if (
    // Dimensioned safe rollouts are not supported at the moment
    (safeRolloutSnapshot.dimension !== "" &&
      safeRolloutSnapshot.dimension !== undefined) ||
    // And no way of generating a data point if there are no metrics monitored, but shouldn't happen
    safeRollout.guardrailMetricIds.length === 0
  ) {
    return;
  }

  const metricGroups = await context.models.metricGroups.getAll();
  const metricsIds = expandMetricGroups(
    safeRollout.guardrailMetricIds,
    metricGroups,
  );

  const analysis = safeRolloutSnapshot.analyses?.[0];
  const analysisResults = analysis?.results?.[0];
  const variations = analysisResults?.variations;

  if (!variations || variations.length === 0) {
    return;
  }

  // Only control & variant are expected for Safe Rollouts
  if (variations.length !== 2) {
    logger.warn(
      `Safe Rollout ${safeRollout.id} has ${variations.length} variations, expected 2`,
    );
  }

  let factMetrics: FactMetricInterface[] | undefined = undefined;
  let factTableMap: Map<string, FactTableInterface> | undefined = undefined;
  const factMetricsIds: string[] = metricsIds.filter(isFactMetricId);
  if (factMetricsIds.length > 0) {
    factMetrics = await context.models.factMetrics.getByIds(factMetricsIds);
    factTableMap = await getFactTableMap(context);
  }

  const timeSeriesVariationsPerMetricId = metricsIds.reduce(
    (acc, metricId) => {
      acc[metricId] = variations.map((_, variationIndex) => ({
        id: safeRolloutSnapshot.settings.variations[variationIndex].id,
        name: SAFE_ROLLOUT_VARIATIONS[variationIndex].name,
        stats:
          analysisResults?.variations[variationIndex]?.metrics[metricId]?.stats,
        absolute: convertMetricToMetricValue(
          analysisResults?.variations[variationIndex]?.metrics[metricId],
        ),
      }));

      return acc;
    },
    {} as Record<string, MetricTimeSeriesVariation[]>,
  );

  const settingsHash = getSafeRolloutSettingsHash(
    safeRolloutSnapshot.settings,
    analysis.settings,
  );

  const metricTimeSeriesSingleDataPoints: CreateMetricTimeSeriesSingleDataPoint[] =
    metricsIds.map((metricId) => ({
      source: "safe-rollout",
      sourceId: safeRollout.id,
      metricId,
      lastExperimentSettingsHash: settingsHash,
      lastMetricSettingsHash: getSafeRolloutMetricSettingsHash(
        metricId,
        safeRolloutSnapshot.settings.metricSettings.find(
          (it) => it.id === metricId,
        ),
        factMetrics,
        factTableMap,
      ),
      singleDataPoint: {
        date: safeRolloutSnapshot.dateCreated,
        variations: timeSeriesVariationsPerMetricId[metricId],
        ...(notificationTriggered && { tags: ["triggered-alert"] }),
      },
    }));

  await context.models.metricTimeSeries.upsertMultipleSingleDataPoint(
    metricTimeSeriesSingleDataPoints,
  );
}

// Adjusted function for SafeRolloutSnapshotMetric type
function convertMetricToMetricValue(
  metric: SafeRolloutSnapshotMetricInterface | undefined,
): MetricTimeSeriesValue | undefined {
  if (!metric) {
    return undefined;
  }

  // NB: Explicitly naming all fields based on MetricTimeSeriesValue definition
  return {
    value: metric.value,
    denominator: metric.denominator ?? undefined,
    expected: metric.expected ?? undefined,
    ci: metric.ci ?? undefined,
    pValue: metric.pValue ?? undefined,
    pValueAdjusted: metric.pValueAdjusted ?? undefined,
    chanceToWin: metric.chanceToWin ?? undefined,
  };
}

const hashObject = (obj: object) => md5(JSON.stringify(obj));

function getSafeRolloutSettingsHash(
  snapshotSettings: SafeRolloutSnapshotSettings,
  snapshotAnalysisSettings: SafeRolloutSnapshotAnalysisSettings,
): string {
  return hashObject({
    // Snapshot Settings
    queryFilter: snapshotSettings.queryFilter,
    datasourceId: snapshotSettings.datasourceId,
    exposureQueryId: snapshotSettings.exposureQueryId,
    startDate: snapshotSettings.startDate,
    regressionAdjustmentEnabled: snapshotSettings.regressionAdjustmentEnabled,
    experimentId: snapshotSettings.experimentId,

    // Analysis Settings
    statsEngine: snapshotAnalysisSettings.statsEngine,
    regressionAdjusted: snapshotAnalysisSettings.regressionAdjusted,
    sequentialTesting: snapshotAnalysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      snapshotAnalysisSettings.sequentialTestingTuningParameter,
    pValueCorrection: snapshotAnalysisSettings.pValueCorrection,
  });
}

function getSafeRolloutMetricSettingsHash(
  metricId: string,
  metricSettings: MetricForSafeRolloutSnapshot | undefined,
  factMetrics?: FactMetricInterface[],
  factTableMap?: Map<string, FactTableInterface>,
): string {
  const factMetric = factMetrics?.find((metric) => metric.id === metricId);
  if (!factMetric) {
    return hashObject(metricSettings ?? { id: metricId });
  } else {
    const numeratorFactTableId = factMetric.numerator.factTableId;
    const numeratorFactTable = numeratorFactTableId
      ? factTableMap?.get(numeratorFactTableId)
      : undefined;

    const denominatorFactTableId = factMetric.denominator?.factTableId;
    const denominatorFactTable = denominatorFactTableId
      ? factTableMap?.get(denominatorFactTableId)
      : undefined;

    const numeratorFilters = numeratorFactTable?.filters.filter((it) =>
      factMetric.numerator.filters.includes(it.id),
    );

    return hashObject({
      ...metricSettings,
      metricType: factMetric.metricType,
      numerator: factMetric.numerator,
      denominator: factMetric.denominator,
      cappingSettings: factMetric.cappingSettings,
      quantileSettings: factMetric.quantileSettings,
      numeratorFactTable: {
        sql: numeratorFactTable?.sql,
        eventName: numeratorFactTable?.eventName,
        filters: numeratorFilters?.map((it) => ({
          id: it.id,
          name: it.name,
          value: it.value,
        })),
      },
      denominatorFactTable: {
        sql: denominatorFactTable?.sql,
        eventName: denominatorFactTable?.eventName,
      },
    });
  }
}
