import cloneDeep from "lodash/cloneDeep";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricData,
  FactMetricPercentileData,
  FactMetricQuantileData,
  FactMetricSource,
} from "shared/types/integrations";
import { type ExperimentMetricInterface } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { applyMetricOverrides } from "back-end/src/util/integration";

import { getFactMetricQuantileData } from "back-end/src/integrations/sql/columns/fact-metric-quantile-data";
import { getFactTablesForMetrics } from "back-end/src/integrations/sql/fact-metrics/fact-tables-for-metrics";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";

// Parses the inputs needed to generate SQL for any incremental-refresh fact-
// metric query (per-FT insert, per-FT covariate insert, or stats join).
//
// The return shape separates "source identity / temporal scoping" (one entry
// per fact table that needs a cache) from "metric data" (one entry per unique
// metric, regardless of how many fact tables it touches). Cross-FT ratio
// metrics appear once in `metricData` and self-identify which sources their
// numerator and denominator live in via `numeratorSourceIndex` and
// `denominatorSourceIndex` — so consumers never have to dedupe a per-source
// fan-out back into a global list.
export function parseExperimentFactMetricsParams(
  dialect: SqlDialect,
  params: {
    metrics: FactMetricInterface[];
    activationMetric: ExperimentMetricInterface | null;
    settings: ExperimentSnapshotSettings;
    factTableMap: FactTableMap;
    lastMaxTimestamp: Date | null;
    covariateTableAlias: string;
    forcedUserIdType?: string;
    // When set, restrict fact-table discovery to a single FT. Cross-FT
    // ratio metrics still contribute to that FT's bucket for whichever
    // side (numerator or denominator) references the target — the other
    // side is silently ignored and is expected to be handled by a
    // separate call scoped to its own FT. Used by per-FT incremental
    // refresh inserts so a metric hub like `[A/B, A/C]` can populate the
    // FT_A cache without tripping the 2-FT cap on {A, B, C}.
    targetFactTableId?: string;
  },
): {
  // One entry per fact table touched by `metrics` (clamped to a single entry
  // when `targetFactTableId` is set). Stable order: fact tables appear in the
  // order their first metric was supplied.
  sources: FactMetricSource[];
  // Flat global lists — exactly one entry per unique metric, no per-source
  // duplication. Cross-FT ratio metrics appear once and carry
  // `numeratorSourceIndex` / `denominatorSourceIndex` so downstream code can
  // partition them per source on demand.
  metricData: FactMetricData[];
  percentileData: FactMetricPercentileData[];
  eventQuantileData: FactMetricQuantileData[];
  regressionAdjustedMetrics: FactMetricData[];
  activationMetric: ExperimentMetricInterface | null;
} {
  const { settings } = params;
  const metricsWithIndices = cloneDeep(params.metrics).map((m, i) => ({
    metric: m,
    index: i,
  }));

  metricsWithIndices.forEach((m) => {
    applyMetricOverrides(m.metric, settings);
  });

  const activationMetric = processActivationMetric(
    params.activationMetric,
    settings,
  );

  const factTableMap = params.factTableMap;

  const factTablesWithMetrics = getFactTablesForMetrics(
    metricsWithIndices,
    factTableMap,
    params.targetFactTableId,
  );

  const metricData = metricsWithIndices.map((m) => {
    return getMetricData(
      dialect,
      { metric: m.metric, index: m.index },
      settings,
      activationMetric,
      factTablesWithMetrics,
      params.covariateTableAlias,
      `m${m.index}`,
    );
  });

  // Build the flat per-metric pivots once, from the global metricData. Each
  // entry carries its `sourceIndex` (already set in metric-data.ts), so
  // consumers can partition per source by filtering on that field.
  const percentileData: FactMetricPercentileData[] = [];
  metricData.forEach((m) => {
    // Upper-tail percentile cap uses the metric's own (upper) cappingSettings.
    if (m.isUpperPercentileCapped) {
      percentileData.push({
        valueCol: `${m.alias}_value`,
        outputCol: `${m.alias}_value_cap`,
        percentile: m.metric.cappingSettings.value ?? 1,
        ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
        sourceIndex: m.numeratorSourceIndex,
      });
      if (m.ratioMetric) {
        percentileData.push({
          valueCol: `${m.alias}_denominator`,
          outputCol: `${m.alias}_denominator_cap`,
          percentile: m.metric.cappingSettings.value ?? 1,
          ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
          sourceIndex: m.denominatorSourceIndex,
        });
      }
    }
    // Lower-tail percentile cap uses the independent lowerCappingSettings.
    if (m.isLowerPercentileCapped) {
      const lower = m.metric.lowerCappingSettings;
      percentileData.push({
        valueCol: `${m.alias}_value`,
        outputCol: `${m.alias}_value_cap_lower`,
        percentile: lower?.value ?? 0,
        ignoreZeros: lower?.ignoreZeros ?? false,
        sourceIndex: m.numeratorSourceIndex,
      });
      if (m.ratioMetric) {
        percentileData.push({
          valueCol: `${m.alias}_denominator`,
          outputCol: `${m.alias}_denominator_cap_lower`,
          percentile: lower?.value ?? 0,
          ignoreZeros: lower?.ignoreZeros ?? false,
          sourceIndex: m.denominatorSourceIndex,
        });
      }
    }
  });

  const eventQuantileData = getFactMetricQuantileData(metricData, "event");

  const regressionAdjustedMetrics = metricData.filter(
    (m) => m.regressionAdjusted,
  );

  // Per-source temporal scoping. These are derived from the metrics anchored
  // in this source — i.e. the same per-bucket logic as before, just expressed
  // as one row per source rather than a row that also bundles redundant
  // metric-level arrays.
  const sources: FactMetricSource[] = factTablesWithMetrics.map((f) => {
    const sourceMetricData = metricData.filter((m) =>
      f.metrics.some((fm) => fm.metric.id === m.metric.id),
    );

    const maxHoursToConvert = Math.max(
      ...sourceMetricData.map((m) => m.maxHoursToConvert),
    );

    const metricStart = sourceMetricData.reduce(
      (min, d) => (d.metricStart < min ? d.metricStart : min),
      settings.startDate,
    );
    const metricEnd = sourceMetricData.reduce(
      (max, d) => (d.metricEnd && d.metricEnd > max ? d.metricEnd : max),
      settings.endDate,
    );

    const lastMaxTimestamp = params.lastMaxTimestamp;
    const bindingLastMaxTimestamp =
      !!lastMaxTimestamp && lastMaxTimestamp > metricStart;
    const startDate =
      lastMaxTimestamp && bindingLastMaxTimestamp
        ? lastMaxTimestamp
        : metricStart;

    const sourceRegressionAdjustedMetrics = sourceMetricData.filter(
      (m) => m.regressionAdjusted,
    );
    const minCovariateStartDate = sourceRegressionAdjustedMetrics
      .map((m) => m.raMetricPhaseStartSettings.covariateStartDate)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const maxCovariateEndDate = sourceRegressionAdjustedMetrics
      .map((m) => m.raMetricPhaseStartSettings.covariateEndDate)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      factTable: f.factTable,
      index: f.index,
      maxHoursToConvert,
      metricStart: startDate,
      metricEnd,
      bindingLastMaxTimestamp,
      minCovariateStartDate,
      maxCovariateEndDate,
    };
  });

  return {
    sources,
    metricData,
    percentileData,
    eventQuantileData,
    regressionAdjustedMetrics,
    activationMetric,
  };
}
