import {
  ExperimentMetricInterface,
  isFactFunnelMetric,
} from "shared/experiments";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";

export interface ConversionWindowPartition<
  M extends ExperimentMetricInterface,
> {
  // Null when skipPartialData is off (mixed windows allowed in one query).
  windowHours: number | null;
  // Null for the skipPartialData-off partition (un-suffixed query name).
  // Otherwise an ascending index (0, 1, …) used as `_w${windowOrdinal}` on
  // DAG node names so they stay unique without putting the window into a
  // table identifier.
  windowOrdinal: number | null;
  metrics: M[];
}

// Same call the stats CTE uses (metric-data.ts) so a partition can never
// disagree with the read-side homogeneity assertion. This intentionally
// differs from the standard-path group key in getFactMetricGroup, which keys on
// getMaxHoursToConvert(false, [metric], null). The two are equal today only
// because funnel and activation metrics are blocked on the incremental path;
// keying on the CTE's exact call keeps the partition in lockstep once that
// support is unblocked.
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

export function conversionWindowQueryNameSuffix(
  windowOrdinal: number | null,
): string {
  return windowOrdinal === null ? "" : `_w${windowOrdinal}`;
}

export function partitionMetricsByConversionWindow<
  M extends ExperimentMetricInterface,
>(
  metrics: M[],
  skipPartialData: boolean,
  activationMetric: ExperimentMetricInterface | null,
): ConversionWindowPartition<M>[] {
  if (!skipPartialData) {
    return [{ windowHours: null, windowOrdinal: null, metrics }];
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
    .map(([windowHours, partitionMetrics], idx) => ({
      windowHours,
      windowOrdinal: idx,
      metrics: partitionMetrics,
    }));
}
