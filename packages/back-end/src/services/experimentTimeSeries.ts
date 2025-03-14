import md5 from "md5";
import {
  getAllMetricIdsFromExperiment,
  isFactMetricId,
} from "shared/experiments";
import { ReqContext } from "back-end/types/organization";
import { ExperimentInterface } from "back-end/src/validators/experiments";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotMetric,
} from "back-end/types/experiment-snapshot";
import {
  MetricTimeSeriesValue,
  MetricTimeSeriesVariation,
} from "back-end/src/validators/metric-time-series";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { getFactTableMap } from "back-end/src/models/FactTableModel";

export async function updateExperimentTimeSeries({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
  // TODO: Should we only include in the time series snapshots that are dimensionless?

  const metricsIds = getAllMetricIdsFromExperiment(experiment);
  const relativeAnalysis = experimentSnapshot.analyses.find(
    (analysis) => analysis.settings.differenceType === "relative"
  );
  const absoluteAnalysis = experimentSnapshot.analyses.find(
    (analysis) => analysis.settings.differenceType === "absolute"
  );
  const scaledAnalysis = experimentSnapshot.analyses.find(
    (analysis) => analysis.settings.differenceType === "scaled"
  );

  // NB: Using relative as a base, but it should match absolute & scaled
  const variations = relativeAnalysis?.results[0]?.variations;
  if (!variations || variations.length === 0) {
    return;
  }

  const timeSeriesVariationsPerMetricId = metricsIds.reduce((acc, metricId) => {
    acc[metricId] = variations.map((_, variationIndex) => ({
      name: experiment.variations[variationIndex].name,
      relative: convertMetricToMetricValue(
        relativeAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
      absolute: convertMetricToMetricValue(
        absoluteAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
      scaled: convertMetricToMetricValue(
        scaledAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
    }));

    return acc;
  }, {} as Record<string, MetricTimeSeriesVariation[]>);

  const experimentHash = getExperimentSettingsHash(
    experimentSnapshot.settings,
    relativeAnalysis.settings
  );

  let factMetrics: FactMetricInterface[] | undefined = undefined;
  let factTableMap: Map<string, FactTableInterface> | undefined = undefined;
  const factMetricsIds: string[] = metricsIds.filter(isFactMetricId);
  if (factMetricsIds.length > 0) {
    factMetrics = await context.models.factMetrics.getByIds(factMetricsIds);
    factTableMap = await getFactTableMap(context);
  }

  await context.models.metricTimeSeries.bulkCreateOrUpdate(
    metricsIds.map((metricId) => ({
      source: "experiment",
      sourceId: experiment.id,
      metricId,
      lastExperimentSettingsHash: experimentHash,
      lastMetricSettingsHash: getMetricSettingsHash(
        metricId,
        experimentSnapshot.settings.metricSettings.find(
          (it) => it.id === metricId
        )!,
        factMetrics,
        factTableMap
      ),
      // TODO: Fix this
      stats: {
        users: "123",
        mean: "123",
        stddev: "123",
      },
      dataPoints: [
        {
          date: experimentSnapshot.dateCreated,
          variations: timeSeriesVariationsPerMetricId[metricId],
        },
      ],
    }))
  );
}

function convertMetricToMetricValue(
  metric: SnapshotMetric | undefined
): MetricTimeSeriesValue | undefined {
  if (!metric) {
    return undefined;
  }

  // NB: Explicitly naming all fields to benefit from type safety
  // when SnapshotMetric and MetricTimeSeriesDataPoint change
  return {
    value: metric.value,
    denominator: metric.denominator,
    expected: metric.expected,
    ci: metric.ci,
    pValue: metric.pValue,
    pValueAdjusted: metric.pValueAdjusted,
    chanceToWin: metric.chanceToWin,
  };
}

const hashObject = (obj: object) => md5(JSON.stringify(obj));

function getExperimentSettingsHash(
  snapshotSettings: ExperimentSnapshotSettings,
  snapshotAnalysisSettings: ExperimentSnapshotAnalysisSettings
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
    sequentialTesting: snapshotAnalysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      snapshotAnalysisSettings.sequentialTestingTuningParameter,
    baselineVariationIndex: snapshotAnalysisSettings.baselineVariationIndex,
    pValueCorrection: snapshotAnalysisSettings.pValueCorrection,
  });
}

function getMetricSettingsHash(
  metricId: string,
  metricSettings: MetricForSnapshot,
  factMetrics?: FactMetricInterface[],
  factTableMap?: Map<string, FactTableInterface>
): string {
  const factMetric = factMetrics?.find((metric) => metric.id === metricId);
  if (!factMetric) {
    return hashObject(metricSettings);
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
      factMetric.numerator.filters.includes(it.id)
    );

    // TODO: Some of these have a `updatedate`, should we include it or filter it out?
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
        filters: numeratorFilters,
      },
      denominatorFactTable: {
        sql: denominatorFactTable?.sql,
        eventName: denominatorFactTable?.eventName,
      },
    });
  }
}
