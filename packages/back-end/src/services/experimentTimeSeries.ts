import md5 from "md5";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ReqContext } from "back-end/types/organization";
import { ExperimentInterface } from "back-end/src/validators/experiments";
import {
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "back-end/types/experiment-snapshot";
import {
  MetricTimeSeriesDataPoint,
  MetricTimeSeriesVariation,
} from "back-end/src/validators/metric-time-series";

export async function updateExperimentTimeSeries({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
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
      relative: convertSnapshotMetricToMetricTimeSeriesDataPoint(
        relativeAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
      absolute: convertSnapshotMetricToMetricTimeSeriesDataPoint(
        absoluteAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
      scaled: convertSnapshotMetricToMetricTimeSeriesDataPoint(
        scaledAnalysis?.results[0]?.variations[variationIndex]?.metrics[
          metricId
        ]
      ),
    }));

    return acc;
  }, {} as Record<string, MetricTimeSeriesVariation[]>);

  await context.models.metricTimeSeries.bulkCreateOrUpdate(
    metricsIds.map((metricId) => ({
      source: "experiment",
      sourceId: experiment.id,
      metricId,
      lastSettingsHash: md5(JSON.stringify(experimentSnapshot.settings)),
      dataPoints: [
        {
          date: experimentSnapshot.dateCreated,
          variations: timeSeriesVariationsPerMetricId[metricId],
        },
      ],
    }))
  );
}

function convertSnapshotMetricToMetricTimeSeriesDataPoint(
  metric: SnapshotMetric | undefined
): MetricTimeSeriesDataPoint | undefined {
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
    stats: metric.stats,
    pValue: metric.pValue,
    pValueAdjusted: metric.pValueAdjusted,
    chanceToWin: metric.chanceToWin,
  };
}
