import cloneDeep from "lodash/cloneDeep";
import {
  ExperimentMetricInterface,
  isFactFunnelMetric,
} from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { applyMetricOverrides } from "back-end/src/util/integration";

export interface ConversionWindowPartition<
  M extends ExperimentMetricInterface,
> {
  /** Null when skipPartialData is off (mixed windows allowed in one query). */
  windowHours: number | null;
  /**
   * Null when skipPartialData is off (un-suffixed query name). Otherwise an
   * ascending index used as `_w${windowOrdinal}` on DAG node names so they
   * stay unique without putting the window into a table identifier.
   */
  windowOrdinal: number | null;
  metrics: M[];
}

/**
 * Same call the stats CTE uses (`metric-data.ts`) so a partition can never
 * disagree with the read-side homogeneity assertion. Intentionally differs
 * from `getFactMetricGroup`, which keys on
 * `getMaxHoursToConvert(false, [metric], null)`. Those agree today only
 * because funnel and activation metrics are blocked on the incremental
 * path; matching the CTE keeps the partition in lockstep once that support
 * is unblocked.
 */
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

/**
 * Conversion window after metric overrides, matching what
 * `parseExperimentFactMetricsParams` (and therefore the read-side
 * homogeneity assertion in `getIncrementalRefreshStatisticsQuery`) computes.
 * The cross-FT grouping key must use this: it fans out from raw
 * `planMetricFanOut` metrics, so a per-metric `windowSettings` override would
 * otherwise leave the raw grouping window disagreeing with the overridden
 * asserted window and throw spuriously. The same-FT path already partitions
 * overridden metrics (`getIncrementalRefreshMetricSources` applies overrides
 * upstream), so it lands on the same window without this.
 */
export function getOverriddenMetricConversionWindowHours(
  metric: ExperimentMetricInterface,
  activationMetric: ExperimentMetricInterface | null,
  settings: Pick<ExperimentSnapshotSettings, "metricSettings">,
): number {
  const overridden = cloneDeep(metric);
  applyMetricOverrides(overridden, settings);
  return getMetricConversionWindowHours(overridden, activationMetric);
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
