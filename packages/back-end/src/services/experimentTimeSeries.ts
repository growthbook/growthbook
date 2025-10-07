import md5 from "md5";
import {
  getAllExpandedMetricIdsFromExperiment,
  isFactMetricId,
  expandAllSliceMetricsInMap,
} from "shared/experiments";
import { ReqContext, SequentialTestingSettings } from "back-end/types/organization";
import {
  ExperimentAnalysisSummary,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentInterface,
  GoalMetricStatus,
  GuardrailMetricStatus,
} from "back-end/src/validators/experiments";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotMetric,
} from "back-end/types/experiment-snapshot";
import {
  CreateMetricTimeSeriesSingleDataPoint,
  MetricTimeSeriesValue,
  MetricTimeSeriesVariation,
} from "back-end/src/validators/metric-time-series";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";

export async function updateExperimentTimeSeries({
  context,
  previousAnalysisSummary,
  experiment,
  experimentSnapshot,
  notificationsTriggered,
}: {
  context: ReqContext;
  previousAnalysisSummary?: ExperimentAnalysisSummary;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
  notificationsTriggered: string[];
}) {
  // Only update time series for dimensionless snapshots, but if we want to
  // support dimensions for time series, we should revisit this
  if (
    experimentSnapshot.dimension !== null &&
    experimentSnapshot.dimension !== ""
  ) {
    return;
  }

  const metricGroups = await context.models.metricGroups.getAll();
  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  // Expand all slice metrics (auto and custom) and add them to the metricMap
  expandAllSliceMetricsInMap({
    metricMap,
    factTableMap,
    experiment,
    metricGroups,
  });

  const allMetricIds = getAllExpandedMetricIdsFromExperiment({
    exp: experimentSnapshot.settings,
    expandedMetricMap: metricMap,
    metricGroups,
  });
  const relativeAnalysis = experimentSnapshot.analyses.find(
    (analysis) =>
      analysis.settings.differenceType === "relative" &&
      (analysis.settings.baselineVariationIndex === undefined ||
        analysis.settings.baselineVariationIndex === 0),
  );
  const absoluteAnalysis = experimentSnapshot.analyses.find(
    (analysis) =>
      analysis.settings.differenceType === "absolute" &&
      (analysis.settings.baselineVariationIndex === undefined ||
        analysis.settings.baselineVariationIndex === 0),
  );
  const scaledAnalysis = experimentSnapshot.analyses.find(
    (analysis) =>
      analysis.settings.differenceType === "scaled" &&
      (analysis.settings.baselineVariationIndex === undefined ||
        analysis.settings.baselineVariationIndex === 0),
  );

  // We should always have this, otherwise the snapshot has not
  // been analyzed and we won't have useful data to update the time series with
  const variations = relativeAnalysis?.results[0]?.variations;
  if (!variations || variations.length === 0) {
    return;
  }

  let factMetrics: FactMetricInterface[] | undefined = undefined;
  const factMetricsIds: string[] = allMetricIds.filter(isFactMetricId);
  if (factMetricsIds.length > 0) {
    factMetrics = await context.models.factMetrics.getByIds(factMetricsIds);
  }

  const timeSeriesVariationsPerMetricId = allMetricIds.reduce(
    (acc, metricId) => {
      acc[metricId] = variations.map((_, variationIndex) => ({
        id: experiment.variations[variationIndex].id,
        name: experiment.variations[variationIndex].name,
        stats:
          // NB: Using relative as a base to save space because it matches relative & absolute
          relativeAnalysis?.results[0]?.variations[variationIndex]?.metrics[
            metricId
          ]?.stats,
        relative: convertMetricToMetricValue(
          relativeAnalysis?.results[0]?.variations[variationIndex]?.metrics[
            metricId
          ],
        ),
        absolute: convertMetricToMetricValue(
          absoluteAnalysis?.results[0]?.variations[variationIndex]?.metrics[
            metricId
          ],
        ),
        scaled: convertMetricToMetricValue(
          scaledAnalysis?.results[0]?.variations[variationIndex]?.metrics[
            metricId
          ],
        ),
      }));

      return acc;
    },
    {} as Record<string, MetricTimeSeriesVariation[]>,
  );

  const experimentHash = getExperimentSettingsHash(
    experimentSnapshot.settings,
    relativeAnalysis.settings,
  );

  // As we tag the whole snapshot, we just care if any metric has a significant difference from the previous status
  const hasSignificantDifference = getHasSignificantDifference(
    previousAnalysisSummary,
    experiment.analysisSummary,
  );

  const metricTimeSeriesSingleDataPoints: CreateMetricTimeSeriesSingleDataPoint[] =
    allMetricIds.map((metricId) => ({
      source: "experiment",
      sourceId: experiment.id,
      sourcePhase: experimentSnapshot.phase,
      metricId,
      lastExperimentSettingsHash: experimentHash,
      lastMetricSettingsHash: getMetricSettingsHash(
        metricId,
        experimentSnapshot.settings.metricSettings.find(
          (it) => it.id === metricId,
        ),
        factMetrics,
        factTableMap,
      ),
      singleDataPoint: {
        date: experimentSnapshot.dateCreated,
        variations: timeSeriesVariationsPerMetricId[metricId],
      },
      tags:
        notificationsTriggered.length > 0 || hasSignificantDifference
          ? ["triggered-alert"]
          : undefined,
    }));

  await context.models.metricTimeSeries.upsertMultipleSingleDataPoint(
    metricTimeSeriesSingleDataPoints,
  );
}

function convertMetricToMetricValue(
  metric: SnapshotMetric | undefined,
): MetricTimeSeriesValue | undefined {
  if (!metric) {
    return undefined;
  }

  // NB: Explicitly naming all fields to benefit from type safety
  // when SnapshotMetric and MetricTimeSeriesDataPoint change
  return {
    value: metric.value,
    // FIXME: This converts null into undefined, needed because of type mismatch
    // between zod & mongoose & stats engine
    denominator: metric.denominator ?? undefined,
    expected: metric.expected ?? undefined,
    ci: metric.ci ?? undefined,
    pValue: metric.pValue ?? undefined,
    pValueAdjusted: metric.pValueAdjusted ?? undefined,
    chanceToWin: metric.chanceToWin ?? undefined,
  };
}

const hashObject = (obj: object) => md5(JSON.stringify(obj));

function getExperimentSettingsHash(
  snapshotSettings: ExperimentSnapshotSettings,
  snapshotAnalysisSettings: ExperimentSnapshotAnalysisSettings,
): string {

  // migrate sequential settings backwards to keep hash from changing

  let sequentialSettings: SequentialTestingSettings | Pick<ExperimentSnapshotAnalysisSettings, "sequentialTesting" | "sequentialTestingTuningParameter"> = {};
  if (snapshotAnalysisSettings.sequentialTestingSettings?.type === "standard") {
    sequentialSettings = {
      type: "standard",
      tuningParameter: snapshotAnalysisSettings.sequentialTestingSettings.tuningParameter,
    };
  } else if (snapshotAnalysisSettings.sequentialTestingSettings?.type === "hybrid") {
    sequentialSettings = snapshotAnalysisSettings.sequentialTestingSettings;
  } else {
  }

  // TODO: add unit tests for migration
  return hashObject({
    // snapshotSettings
    activationMetric: snapshotSettings.activationMetric,
    attributionModel: snapshotSettings.attributionModel,
    queryFilter: snapshotSettings.queryFilter,
    segment: snapshotSettings.segment,
    skipPartialData: snapshotSettings.skipPartialData,
    datasourceId: snapshotSettings.datasourceId,
    exposureQueryId: snapshotSettings.exposureQueryId,
    startDate: snapshotSettings.startDate,
    regressionAdjustmentEnabled: snapshotSettings.regressionAdjustmentEnabled,
    experimentId: snapshotSettings.experimentId,

    // analysisSettings
    dimensions: snapshotAnalysisSettings.dimensions,
    statsEngine: snapshotAnalysisSettings.statsEngine,
    regressionAdjusted: snapshotAnalysisSettings.regressionAdjusted,
    ...sequentialSettings,
    baselineVariationIndex: snapshotAnalysisSettings.baselineVariationIndex,
    pValueCorrection: snapshotAnalysisSettings.pValueCorrection,
  });
}

function getMetricSettingsHash(
  metricId: string,
  metricSettings?: MetricForSnapshot,
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

function getHasSignificantDifference(
  previousAnalysisSummary: ExperimentAnalysisSummary | undefined,
  currentAnalysisSummary: ExperimentAnalysisSummary | undefined,
) {
  const currentResults = currentAnalysisSummary?.resultsStatus;
  if (!currentResults) {
    // Unable to compare
    return false;
  }

  const isSignificant = (status: GoalMetricStatus | GuardrailMetricStatus) =>
    status === "won" || status === "lost";

  const parseToMap = (results: ExperimentAnalysisSummaryResultsStatus) => {
    return new Map(
      results.variations.flatMap((variation) => ({
        ...(variation?.goalMetrics
          ? Object.entries(variation.goalMetrics).map(([metricId, metric]) => [
              `${variation.variationId}-${metricId}`,
              metric.status,
            ])
          : []),
        ...(variation?.guardrailMetrics
          ? Object.entries(variation.guardrailMetrics).map(
              ([metricId, metric]) => [
                `${variation.variationId}-${metricId}`,
                metric.status,
              ],
            )
          : []),
      })),
    );
  };

  const currentMetricsParsed = parseToMap(currentResults);

  const previousResults = previousAnalysisSummary?.resultsStatus;
  if (!previousResults) {
    return Object.values(currentMetricsParsed).some(isSignificant);
  }

  const previousResultsMap = parseToMap(previousResults);
  return Object.entries(currentMetricsParsed).some(
    ([metricKey, status]) =>
      isSignificant(status) && previousResultsMap.get(metricKey) !== status,
  );
}
