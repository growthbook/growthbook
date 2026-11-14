import {
  ExperimentMetricInterface,
  isFactFunnelMetric,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricData,
  FactMetricPercentileData,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { conversionWindowMinutesKey } from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";

/**
 * Hours since exposure a unit needs before a metric with `skipPartialData`
 * analyzes it, or null when the metric analyzes every unit in the query.
 */
export function getUnitEligibilityHours(
  metric: ExperimentMetricInterface,
  settings: Pick<
    ExperimentSnapshotSettings,
    "skipPartialData" | "attributionModel" | "banditSettings"
  >,
  activationMetric: ExperimentMetricInterface | null,
): number | null {
  // The experiment-level setting already trims the units of every metric.
  if (settings.skipPartialData) return null;
  if (!isFactMetric(metric) || !metric.skipPartialData) return null;
  // ponytail: Bandits are not trimmed. Their statistics read one shared unit
  // count per row; trimming needs per-metric counts in the bandit CTEs.
  if (settings.banditSettings) return null;
  // ponytail: quantile metrics are not trimmed. Their quantiles are computed
  // outside the per-unit sums this setting filters; trimming them needs the
  // eligibility filter pushed into the quantile CTEs.
  if (quantileMetricType(metric)) return null;
  // Every metric is analyzed over a lookback window anchored on the end date.
  if (settings.attributionModel === "lookbackOverride") return null;

  // "Ignore conversion windows" drops the metric window but keeps the delay
  // and any funnel step windows.
  const effectiveMetric =
    settings.attributionModel === "experimentDuration" &&
    metric.windowSettings.type === "conversion"
      ? {
          ...metric,
          windowSettings: { ...metric.windowSettings, type: "" as const },
        }
      : metric;

  const isFunnel = isFactFunnelMetric(effectiveMetric);
  // No bound on the metric itself means every unit is already complete, even
  // when the activation metric has a window.
  if (getMaxHoursToConvert(isFunnel, [effectiveMetric], null) <= 0) return null;
  return getMaxHoursToConvert(isFunnel, [effectiveMetric], activationMetric);
}

/** Shared count of eligible units for every metric with the same hours. */
export function getEligibleUsersColumn(hours: number): string {
  return `users_cw${conversionWindowMinutesKey(hours)}`;
}

export type UnitEligibility = {
  /** Exposure timestamp column on the per-unit tables. */
  timestampColumn: string;
  settings: Pick<
    ExperimentSnapshotSettings,
    | "skipPartialData"
    | "attributionModel"
    | "banditSettings"
    | "endDate"
    | "endDateIsCutoff"
  >;
  activationMetric: ExperimentMetricInterface | null;
  /** Data freshness the cutoff counts back from; defaults to now. */
  asOf?: Date;
};

/** Latest exposure a unit can have and still be analyzed by the metric. */
export function getUnitEligibilityCutoff(
  dialect: Pick<SqlDialect, "toTimestamp">,
  metric: ExperimentMetricInterface,
  { settings, activationMetric, asOf }: UnitEligibility,
): { hours: number; cutoff: string } | null {
  const hours = getUnitEligibilityHours(metric, settings, activationMetric);
  if (hours === null) return null;
  return {
    hours,
    cutoff: dialect.toTimestamp(
      getExperimentEndDate({ ...settings, skipPartialData: true }, hours, asOf),
    ),
  };
}

/**
 * Table a source's percentile caps read. A trimmed metric's values are NULL,
 * so left out of its percentiles, for the units it does not analyze.
 */
export function getPercentileCapSource(
  dialect: Pick<SqlDialect, "toTimestamp" | "ifElse">,
  table: string,
  percentileData: Pick<FactMetricPercentileData, "valueCol">[],
  metricData: Pick<FactMetricData, "metric" | "alias">[],
  unitEligibility: UnitEligibility | undefined,
): string {
  if (!unitEligibility) return table;
  const conditions = new Map<string, string>();
  metricData.forEach(({ metric, alias }) => {
    const eligibility = getUnitEligibilityCutoff(
      dialect,
      metric,
      unitEligibility,
    );
    if (!eligibility) return;
    const condition = `${unitEligibility.timestampColumn} <= ${eligibility.cutoff}`;
    conditions.set(`${alias}_value`, condition);
    conditions.set(`${alias}_denominator`, condition);
  });
  const columns = [...new Set(percentileData.map((p) => p.valueCol))];
  if (!columns.some((column) => conditions.has(column))) return table;
  return `(SELECT ${columns
    .map((column) => {
      const condition = conditions.get(column);
      return condition
        ? `${dialect.ifElse(condition, column, "NULL")} AS ${column}`
        : column;
    })
    .join(", ")} FROM ${table}) cap_source`;
}
