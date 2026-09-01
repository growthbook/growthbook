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
