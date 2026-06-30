import md5 from "md5";
import {
  getAllExpandedMetricIdsFromExperiment,
  isFactMetricId,
  expandAllSliceMetricsInMap,
  getLatestPhaseVariations,
  isDimensionPrecomputed,
} from "shared/experiments";
import {
  CreateMetricTimeSeriesSingleDataPoint,
  MetricTimeSeriesDataPointTag,
  MetricTimeSeriesValue,
  MetricTimeSeriesVariation,
  ExperimentAnalysisSummary,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentInterface,
  GoalMetricStatus,
  GuardrailMetricStatus,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import {
  FactMetricInterface,
  FactTableInterface,
  ColumnRef,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getTimeSeriesAnalyses } from "back-end/src/services/experimentDimensionTimeSeries";

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
  // This function handles the main (dimensionless) experiment time series.
  // Precomputed dimension time series are written by
  // runEagerExperimentAndUnitDimensionsAnalyses after their analyses are persisted.
  if (
    experimentSnapshot.dimension !== null &&
    experimentSnapshot.dimension !== ""
  ) {
    return;
  }

  const { allMetricIds, factMetrics, factTableMap } =
    await getExperimentTimeSeriesContext({
      context,
      experiment,
      experimentSnapshot,
    });
  const analyses = getTimeSeriesAnalyses({
    analyses: experimentSnapshot.analyses,
  });

  // As we tag the whole snapshot, we just care if any metric has a significant difference from the previous status
  const hasSignificantDifference = getHasSignificantDifference(
    previousAnalysisSummary,
    experiment.analysisSummary,
  );

  await updateExperimentAnalysisTimeSeries({
    context,
    experiment,
    experimentSnapshot,
    analyses,
    allMetricIds,
    factMetrics,
    factTableMap,
    tags:
      notificationsTriggered.length > 0 || hasSignificantDifference
        ? ["triggered-alert"]
        : undefined,
  });
}

export async function getExperimentTimeSeriesContext({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
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

  let factMetrics: FactMetricInterface[] | undefined;
  const factMetricsIds: string[] = allMetricIds.filter(isFactMetricId);
  if (factMetricsIds.length > 0) {
    factMetrics = await context.models.factMetrics.getByIds(factMetricsIds);
  }

  return {
    metricMap,
    factTableMap,
    allMetricIds,
    factMetrics,
  };
}

/**
 * Persists time series for a group of analyses that share the same snapshot
 * context. Dimensionless analyses write the main experiment series; analyses
 * for a precomputed dimension write one series per dimension value.
 */
export async function updateExperimentAnalysisTimeSeries({
  context,
  experiment,
  experimentSnapshot,
  analyses,
  allMetricIds,
  factMetrics,
  factTableMap,
  tags,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
  analyses: ExperimentSnapshotAnalysis[];
  allMetricIds: string[];
  factMetrics: FactMetricInterface[] | undefined;
  factTableMap: Map<string, FactTableInterface>;
  tags?: MetricTimeSeriesDataPointTag[];
}) {
  const dimensionIds = new Set(analyses.flatMap((a) => a.settings.dimensions));
  if (dimensionIds.size > 1) {
    throw new Error(
      "Cannot update time series for analyses from multiple dimensions",
    );
  }
  const [dimensionId] = Array.from(dimensionIds);
  if (
    dimensionId &&
    !isDimensionPrecomputed(
      dimensionId,
      experimentSnapshot.settings.precomputedUnitDimensionIds ?? [],
    )
  ) {
    throw new Error(
      `Cannot update time series for unsupported dimension: ${dimensionId}`,
    );
  }

  const timeSeriesAnalyses = getTimeSeriesAnalyses({
    analyses,
    dimensionId,
  });
  if (timeSeriesAnalyses.length === 0) {
    return;
  }

  const relativeAnalysis = getAnalysisByDifferenceType(
    timeSeriesAnalyses,
    "relative",
  );
  const absoluteAnalysis = getAnalysisByDifferenceType(
    timeSeriesAnalyses,
    "absolute",
  );
  const scaledAnalysis = getAnalysisByDifferenceType(
    timeSeriesAnalyses,
    "scaled",
  );
  const baseAnalysis = relativeAnalysis ?? absoluteAnalysis ?? scaledAnalysis;
  if (!baseAnalysis) {
    throw new Error("No base analysis found for time series");
  }

  const variationIds = getLatestPhaseVariations(experiment);
  const allDataPoints: CreateMetricTimeSeriesSingleDataPoint[] = [];
  const dimensionValues = dimensionId
    ? baseAnalysis.results.map((result) => result.name)
    : [undefined];

  for (const dimensionValue of dimensionValues) {
    const resultsByDifferenceType = {
      relative: getAnalysisResult(relativeAnalysis, dimensionValue),
      absolute: getAnalysisResult(absoluteAnalysis, dimensionValue),
      scaled: getAnalysisResult(scaledAnalysis, dimensionValue),
    };
    const baseResult =
      resultsByDifferenceType.relative ??
      resultsByDifferenceType.absolute ??
      resultsByDifferenceType.scaled;
    if (!baseResult?.variations?.length) continue;

    const experimentHash = getExperimentSettingsHash(
      experimentSnapshot.settings,
      baseAnalysis.settings,
    );

    for (const metricId of allMetricIds) {
      const variations: MetricTimeSeriesVariation[] = variationIds.map(
        (v, variationIndex) => {
          const relativeMetric =
            resultsByDifferenceType.relative?.variations[variationIndex]
              ?.metrics[metricId];
          const absoluteMetric =
            resultsByDifferenceType.absolute?.variations[variationIndex]
              ?.metrics[metricId];
          const scaledMetric =
            resultsByDifferenceType.scaled?.variations[variationIndex]?.metrics[
              metricId
            ];

          return {
            id: v.id,
            name: v.name,
            stats:
              (relativeMetric ?? absoluteMetric ?? scaledMetric)?.stats ??
              undefined,
            relative: convertMetricToMetricValue(relativeMetric),
            absolute: convertMetricToMetricValue(absoluteMetric),
            scaled: convertMetricToMetricValue(scaledMetric),
          };
        },
      );

      const baseDataPoint = {
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
          variations,
          ...(tags?.length ? { tags: [...tags] } : {}),
        },
      } as const;

      allDataPoints.push(
        dimensionId && dimensionValue !== undefined
          ? {
              ...baseDataPoint,
              dimensionId,
              dimensionValue,
            }
          : baseDataPoint,
      );
    }
  }

  if (allDataPoints.length === 0) {
    return;
  }

  await context.models.metricTimeSeries.upsertMultipleSingleDataPoint(
    allDataPoints,
  );
}

function getAnalysisResult(
  analysis: ExperimentSnapshotAnalysis | undefined,
  dimensionValue: string | undefined,
): ExperimentSnapshotAnalysis["results"][number] | undefined {
  if (!analysis) return undefined;
  if (dimensionValue === undefined) return analysis.results[0];
  return analysis.results.find((result) => result.name === dimensionValue);
}

function getAnalysisByDifferenceType(
  analyses: ExperimentSnapshotAnalysis[],
  differenceType: ExperimentSnapshotAnalysisSettings["differenceType"],
): ExperimentSnapshotAnalysis | undefined {
  return analyses.find(
    (analysis) =>
      analysis.results.length > 0 &&
      analysis.settings.differenceType === differenceType,
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
    postStratificationEnabled:
      snapshotAnalysisSettings.postStratificationEnabled,
    sequentialTesting: snapshotAnalysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      snapshotAnalysisSettings.sequentialTestingTuningParameter,
    baselineVariationIndex: snapshotAnalysisSettings.baselineVariationIndex,
    pValueCorrection: snapshotAnalysisSettings.pValueCorrection,
  });
}

export function getFiltersForHash(
  factTable: FactTableInterface | undefined,
  columnRef: ColumnRef | null,
) {
  if (!factTable || !columnRef) {
    return undefined;
  }

  const savedFilterIds = (columnRef.rowFilters || [])
    .filter((f) => f.operator === "saved_filter")
    .map((f) => f.values?.[0]);

  return factTable.filters
    .filter((it) => savedFilterIds.includes(it.id))
    .map((it) => ({
      id: it.id,
      name: it.name,
      value: it.value,
    }));
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
        filters: getFiltersForHash(numeratorFactTable, factMetric.numerator),
      },
      denominatorFactTable: {
        sql: denominatorFactTable?.sql,
        eventName: denominatorFactTable?.eventName,
        // TODO: also include denominator filters?
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
