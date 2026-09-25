import cloneDeep from "lodash/cloneDeep";
import {
  ExperimentMetricInterface,
  isFactFunnelMetric,
  quantileMetricType,
} from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { applyMetricOverrides } from "back-end/src/util/integration";

export interface ConversionWindowPartition<
  M extends ExperimentMetricInterface,
> {
  window: { hours: number; key: string } | null;
  metrics: M[];
}

// Match the stats CTE (metric-data.ts), including funnel and activation —
// not getFactMetricGroup, which ignores those.
export function getMetricConversionWindowHours(
  metric: ExperimentMetricInterface,
  activationMetric: ExperimentMetricInterface | null,
): number {
  return getMaxHoursToConvert(
    isFactFunnelMetric(metric),
    [metric],
    activationMetric,
  );
}

// Cross-FT grouping fans out from raw planMetricFanOut metrics, so overrides
// must be applied here. Same-FT already applies them upstream.
export function getOverriddenMetricConversionWindowHours(
  metric: ExperimentMetricInterface,
  activationMetric: ExperimentMetricInterface | null,
  settings: Pick<ExperimentSnapshotSettings, "metricSettings">,
): number {
  const overridden = cloneDeep(metric);
  applyMetricOverrides(overridden, settings);
  return getMetricConversionWindowHours(overridden, activationMetric);
}

export function conversionWindowMinutesKey(hours: number): string {
  return `${Math.round(hours * 60)}m`;
}

export function conversionWindowQueryNameSuffix(
  windowKey: string | null | undefined,
): string {
  return (windowKey ?? null) === null ? "" : `_cw${windowKey}`;
}

export function partitionMetricsByConversionWindow<
  M extends ExperimentMetricInterface,
>(
  metrics: M[],
  skipPartialData: boolean,
  activationMetric: ExperimentMetricInterface | null,
): ConversionWindowPartition<M>[] {
  if (!skipPartialData) {
    return [{ window: null, metrics }];
  }

  const byWindow = new Map<number, M[]>();
  for (const metric of metrics) {
    const hours = getMetricConversionWindowHours(metric, activationMetric);
    const bucket = byWindow.get(hours);
    if (bucket) {
      bucket.push(metric);
    } else {
      byWindow.set(hours, [metric]);
    }
  }

  return [...byWindow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hours, partitionMetrics]) => ({
      window: { hours, key: conversionWindowMinutesKey(hours) },
      metrics: partitionMetrics,
    }));
}

export interface StatisticsQueryChunk<M extends ExperimentMetricInterface> {
  metrics: M[];
  // Appended to `statistics_<groupId>`: the partition's conversion-window
  // suffix, plus the metric id when a quantile metric is split out.
  nameSuffix: string;
}

// Without efficient percentiles (Redshift), every PERCENTILE_CONT in a SELECT
// must share one WITHIN GROUP ordering, so each quantile metric gets its own
// statistics query. Mirrors the standard path's grouping in experimentQueries.
export function getStatisticsQueryChunks<M extends ExperimentMetricInterface>(
  partition: ConversionWindowPartition<M>,
  hasEfficientPercentiles: boolean,
): StatisticsQueryChunk<M>[] {
  const windowSuffix = conversionWindowQueryNameSuffix(partition.window?.key);
  const unsplit = [{ metrics: partition.metrics, nameSuffix: windowSuffix }];
  if (hasEfficientPercentiles) {
    return unsplit;
  }

  const others = partition.metrics.filter((m) => !quantileMetricType(m));
  const chunks = [
    ...(others.length > 0
      ? [{ metrics: others, nameSuffix: windowSuffix }]
      : []),
    ...partition.metrics
      .filter((m) => quantileMetricType(m))
      .map((m) => ({ metrics: [m], nameSuffix: `${windowSuffix}_${m.id}` })),
  ];
  return chunks.length > 1 ? chunks : unsplit;
}
