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
import { getClusterMetricCacheLevel } from "back-end/src/integrations/sql/fact-metrics/cluster-metric-grain";
import { conversionWindowMinutesKey } from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";

type UnitEligibilitySettings = Pick<
  ExperimentSnapshotSettings,
  | "skipPartialData"
  | "attributionModel"
  | "banditSettings"
  | "isClusterExperiment"
  | "clusterSubUnitIdentifier"
  | "clusterLevelMetricIds"
>;

/**
 * Hours a unit needs since its exposure, or its activation in an experiment
 * with an activation metric, before a metric with `skipPartialData` analyzes
 * it. Null when the metric analyzes every unit in the query.
 *
 * A snapshot records the hours of its metrics (`recordUnitEligibility`), so
 * its results are read the way its queries were written whatever the metric
 * looks like now. Only settings with no entry for the metric, like Population
 * Data's, work the hours out from the metric.
 */
export function getUnitEligibilityHours(
  metric: ExperimentMetricInterface,
  settings: UnitEligibilitySettings &
    Pick<ExperimentSnapshotSettings, "metricSettings">,
): number | null {
  const recorded = settings.metricSettings.find(
    (s) => s.id === metric.id,
  )?.computedSettings;
  if (recorded) return recorded.unitEligibilityHours ?? null;
  return computeUnitEligibilityHours(metric, settings);
}

/**
 * Record on freshly built snapshot settings the hours of each metric that
 * only analyzes units with complete data.
 */
export function recordUnitEligibility(
  settings: UnitEligibilitySettings &
    Pick<ExperimentSnapshotSettings, "metricSettings">,
  metricMap: Map<string, ExperimentMetricInterface>,
): void {
  settings.metricSettings.forEach(({ id, computedSettings }) => {
    const metric = metricMap.get(id);
    if (!metric || !computedSettings) return;
    // The window the snapshot analyzes the metric over, which an experiment
    // can override.
    const { windowSettings } = computedSettings;
    const hours = computeUnitEligibilityHours(
      windowSettings ? { ...metric, windowSettings } : metric,
      settings,
    );
    // Left unset otherwise so existing metric hashes stay unchanged.
    if (hours !== null) computedSettings.unitEligibilityHours = hours;
  });
}

function computeUnitEligibilityHours(
  metric: ExperimentMetricInterface,
  settings: UnitEligibilitySettings,
): number | null {
  // The experiment-level setting already trims the units of every metric.
  if (settings.skipPartialData) return null;
  if (!isFactMetric(metric) || !metric.skipPartialData) return null;
  // ponytail: Bandits are not trimmed. Their statistics read one shared unit
  // count per row; trimming needs per-metric counts in the bandit CTEs.
  if (settings.banditSettings) return null;
  // ponytail: sub-unit metrics in cluster experiments are not trimmed. Their
  // statistics rows are already rolled up to the cluster, with no per-unit
  // exposure timestamp; trimming needs the filter pushed below the rollup.
  if (getClusterMetricCacheLevel(settings, metric.id) === "subunit") {
    return null;
  }
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

  const hours = getMaxHoursToConvert(isFactFunnelMetric(effectiveMetric), [
    effectiveMetric,
  ]);
  // No bound on the metric means every unit is already complete.
  return hours > 0 ? hours : null;
}

export const ELIGIBLE_USERS_COLUMN_PREFIX = "users_cw";

/** Shared count of eligible units for every metric with the same hours. */
export function getEligibleUsersColumn(hours: number): string {
  return `${ELIGIBLE_USERS_COLUMN_PREFIX}${conversionWindowMinutesKey(hours)}`;
}

/**
 * Column counting the units a metric's statistics cover, or null when they
 * cover every unit in the query.
 */
export function getMetricUsersColumn(
  ...args: Parameters<typeof getUnitEligibilityHours>
): string | null {
  const hours = getUnitEligibilityHours(...args);
  return hours === null ? null : getEligibleUsersColumn(hours);
}

export type UnitEligibility = {
  /** Column on the per-unit tables with the timestamp a unit's wait runs from. */
  timestampColumn: string;
  settings: UnitEligibilitySettings &
    Pick<
      ExperimentSnapshotSettings,
      "metricSettings" | "endDate" | "endDateIsCutoff"
    >;
  /** Data freshness the cutoff counts back from; defaults to now. */
  asOf?: Date;
};

/** Latest exposure a unit can have and still be analyzed by the metric. */
export function getUnitEligibilityCutoff(
  dialect: Pick<SqlDialect, "toTimestamp">,
  metric: ExperimentMetricInterface,
  { settings, asOf }: UnitEligibility,
): { hours: number; cutoff: string } | null {
  const hours = getUnitEligibilityHours(metric, settings);
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
