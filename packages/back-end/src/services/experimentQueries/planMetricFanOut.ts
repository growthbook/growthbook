import { isRatioMetric, isRegressionAdjusted } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import cloneDeep from "lodash/cloneDeep";
import { applyMetricOverrides } from "back-end/src/util/integration";

// A single cross-fact-table ratio metric — its numerator and denominator live
// in different fact tables. The cross-FT stats query joins both fact tables'
// cache tables to compute the ratio.
export interface CrossFtRatioMetric {
  metric: FactMetricInterface;
  numeratorFactTableId: string;
  denominatorFactTableId: string;
}

export interface MetricFanOut {
  // One entry per fact table that needs a cache. Order is stable: fact tables
  // appear in the order their first metric was supplied. A cross-FT ratio
  // metric shows up in BOTH of its fact tables' entries; downstream consumers
  // distinguish numerator-side vs denominator-side by comparing each metric's
  // `numerator.factTableId` / `denominator.factTableId` against the outer
  // `factTableId` (see `getMetricSourceTableSchema` for the canonical rule).
  perFt: Array<{
    factTableId: string;
    metrics: FactMetricInterface[];
  }>;
  // One entry per unordered fact-table pair that participates in at least one
  // cross-FT ratio metric. Each pair collects every metric joining those two
  // tables (in either numerator/denominator orientation). Order is stable:
  // pairs appear in the order their first metric was supplied, and within
  // each pair `factTableIds` is sorted so {A,B} == {B,A}.
  crossFtPairs: Array<{
    factTableIds: [string, string];
    metrics: CrossFtRatioMetric[];
  }>;
}

// Returns true iff `metric` is a ratio metric whose numerator and denominator
// live in different fact tables.
export function isCrossFtRatioMetric(
  metric: FactMetricInterface,
): metric is FactMetricInterface & {
  denominator: NonNullable<FactMetricInterface["denominator"]>;
} {
  return (
    isRatioMetric(metric) &&
    !!metric.denominator?.factTableId &&
    metric.denominator.factTableId !== metric.numerator.factTableId
  );
}

// Stable key for an unordered fact-table pair (so {A,B} and {B,A} collide).
export function getCrossFtPairKey(
  factTableIdA: string,
  factTableIdB: string,
): string {
  return factTableIdA < factTableIdB
    ? `${factTableIdA}__${factTableIdB}`
    : `${factTableIdB}__${factTableIdA}`;
}

// Compute the canonical fan-out for a list of metrics — i.e. which fact
// tables host which metrics, and which fact-table pairs need a joined stats
// query.
//
// This is the single source of truth for that layout. Everything downstream
// (schema generation, change detection, runner orchestration) should derive
// what it needs from the same call to this function so the runner and SQL
// stay in lock-step.
//
// For each metric:
//   - non-ratio or same-FT ratio metric: appears once, in its numerator FT.
//   - cross-FT ratio metric: appears in BOTH its numerator and denominator
//     FTs (the schema gen / insert SQL inspect the metric's numerator and
//     denominator factTableIds to figure out which side this cache owns), and
//     once in `crossFtPairs` under the unordered FT pair.
//
// Metric, FT, and pair ordering is stable in the supplied metric order so
// the resulting query layout is deterministic across runs.
export function planMetricFanOut(metrics: FactMetricInterface[]): MetricFanOut {
  const perFtMap = new Map<
    string,
    { factTableId: string; metrics: FactMetricInterface[] }
  >();
  const crossFtPairMap = new Map<
    string,
    {
      factTableIds: [string, string];
      metrics: CrossFtRatioMetric[];
    }
  >();

  const upsertMetric = (factTableId: string, metric: FactMetricInterface) => {
    const existing = perFtMap.get(factTableId);
    if (existing) {
      existing.metrics.push(metric);
    } else {
      perFtMap.set(factTableId, { factTableId, metrics: [metric] });
    }
  };

  metrics.forEach((metric) => {
    const numeratorFactTableId = metric.numerator?.factTableId;
    if (!numeratorFactTableId) {
      throw new Error(
        `Fact metric "${metric.id}" is missing a numerator fact table.`,
      );
    }

    upsertMetric(numeratorFactTableId, metric);
    if (!isCrossFtRatioMetric(metric)) return;

    const denominatorFactTableId = metric.denominator.factTableId;
    upsertMetric(denominatorFactTableId, metric);

    // Sort the pair so {A,B} and {B,A} collide in the pair map. We still
    // remember each metric's original numerator/denominator orientation in
    // the CrossFtRatioMetric entry so the stats query stays correct.
    const pairKey = getCrossFtPairKey(
      numeratorFactTableId,
      denominatorFactTableId,
    );
    const sortedPair: [string, string] =
      numeratorFactTableId < denominatorFactTableId
        ? [numeratorFactTableId, denominatorFactTableId]
        : [denominatorFactTableId, numeratorFactTableId];

    const crossFtMetric: CrossFtRatioMetric = {
      metric,
      numeratorFactTableId,
      denominatorFactTableId,
    };

    const existingPair = crossFtPairMap.get(pairKey);
    if (existingPair) {
      existingPair.metrics.push(crossFtMetric);
    } else {
      crossFtPairMap.set(pairKey, {
        factTableIds: sortedPair,
        metrics: [crossFtMetric],
      });
    }
  });

  return {
    perFt: Array.from(perFtMap.values()),
    crossFtPairs: Array.from(crossFtPairMap.values()),
  };
}

// Returns the subset of `metrics` that should carry CUPED for the given
// snapshot. A metric is regression-adjusted iff:
//   1. The snapshot has regression adjustment enabled.
//   2. After applying snapshot-level metric overrides, the metric itself is
//      regression-adjusted (`regressionAdjustmentDays > 0` &&
//      `regressionAdjustmentEnabled` && not a legacy/unsupported metric type).
//
// Centralized here so the runner, schema generation, and validation all share
// one rule for "what counts as RA" — the per-call `applyMetricOverrides`
// matters because users can flip RA on/off at the snapshot level.
export function filterRegressionAdjustedMetrics(
  metrics: FactMetricInterface[],
  snapshotSettings: ExperimentSnapshotSettings,
): FactMetricInterface[] {
  if (!snapshotSettings.regressionAdjustmentEnabled) return [];
  return metrics.filter((m) => {
    const metric = cloneDeep(m);
    applyMetricOverrides(metric, snapshotSettings);
    return isRegressionAdjusted(metric);
  });
}

// Convenience predicate: true iff at least one metric in `metrics` is
// regression-adjusted under `snapshotSettings`. Avoids repeating the same
// `cloneDeep + applyMetricOverrides + isRegressionAdjusted` boilerplate in
// multiple runners.
export function hasAnyRegressionAdjustedMetric(
  metrics: FactMetricInterface[],
  snapshotSettings: ExperimentSnapshotSettings,
): boolean {
  return filterRegressionAdjustedMetrics(metrics, snapshotSettings).length > 0;
}
