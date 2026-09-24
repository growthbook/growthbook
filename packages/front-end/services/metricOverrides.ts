import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";

/** The blue that marks an overridden metric, on its chip and in its card. */
export const METRIC_OVERRIDE_COLOR = "var(--blue-9)";

/** Which setting a row is about, so an override can stand in for it. */
export type MetricSettingKey =
  | "window"
  | "delay"
  | "winRisk"
  | "loseRisk"
  | "cuped"
  | "prior";

export interface OverrideRow {
  key: MetricSettingKey;
  label: string;
  value: string;
}

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(4))}%`;

const hours = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;

const cuped = (enabled?: boolean, days?: number) =>
  enabled ? (days !== undefined ? `On, ${days} day lookback` : "On") : "Off";

const prior = (proper?: boolean, mean?: number, stddev?: number) =>
  proper ? `Proper (mean ${mean ?? 0}, sd ${stddev ?? 1})` : "Improper";

/**
 * An experiment's override of one metric, as the rows a person reads. A field
 * left unset keeps the metric's own setting, so it isn't listed.
 */
export function describeMetricOverride(o: MetricOverride): OverrideRow[] {
  const rows: OverrideRow[] = [];

  if (o.windowType !== undefined) {
    if (o.windowType === "") {
      rows.push({ key: "window", label: "Metric window", value: "None" });
    } else {
      rows.push({
        key: "window",
        label:
          o.windowType === "conversion"
            ? "Conversion window"
            : "Lookback window",
        value: o.windowHours !== undefined ? hours(o.windowHours) : "Default",
      });
    }
  }
  if (o.delayHours !== undefined) {
    rows.push({
      key: "delay",
      label: "Metric delay",
      value: hours(o.delayHours),
    });
  }
  if (o.winRisk !== undefined) {
    rows.push({ key: "winRisk", label: "Win risk", value: percent(o.winRisk) });
  }
  if (o.loseRisk !== undefined) {
    rows.push({
      key: "loseRisk",
      label: "Lose risk",
      value: percent(o.loseRisk),
    });
  }
  if (o.regressionAdjustmentOverride) {
    rows.push({
      key: "cuped",
      label: "CUPED",
      value: cuped(o.regressionAdjustmentEnabled, o.regressionAdjustmentDays),
    });
  }
  if (o.properPriorOverride) {
    rows.push({
      key: "prior",
      label: "Prior",
      value: prior(
        o.properPriorEnabled,
        o.properPriorMean,
        o.properPriorStdDev,
      ),
    });
  }

  return rows;
}

/** How a metric is analysed in an experiment before any override of it. */
export interface MetricSettingsInput {
  windowType: "conversion" | "lookback" | "" | undefined;
  windowHours: number;
  delayHours: number;
  /** The experiment's analysis ignores conversion windows (not lookbacks). */
  conversionWindowsIgnored: boolean;
  winRisk: number;
  loseRisk: number;
  /** Left out where the organization can't use CUPED at all. */
  cuped: { enabled: boolean; days: number } | null;
  prior: { proper: boolean; mean: number; stddev: number };
}

/**
 * A metric's settings in this experiment, as rows alongside its overrides:
 * each one the override doesn't already cover. Bayesian-only settings are
 * left out under the frequentist engine, which ignores them.
 */
export function describeMetricSettings(
  s: MetricSettingsInput,
  statsEngine: StatsEngine,
  override: MetricOverride | undefined,
): OverrideRow[] {
  const bayesian = statsEngine === "bayesian";
  const rows: OverrideRow[] = [
    s.windowType
      ? {
          key: "window",
          label:
            s.windowType === "conversion"
              ? "Conversion window"
              : "Lookback window",
          value:
            s.windowType === "conversion" && s.conversionWindowsIgnored
              ? "Ignored by this experiment"
              : hours(s.windowHours),
        }
      : { key: "window", label: "Metric window", value: "None" },
  ];
  if (s.delayHours) {
    rows.push({
      key: "delay",
      label: "Metric delay",
      value: hours(s.delayHours),
    });
  }
  if (bayesian) {
    rows.push(
      { key: "winRisk", label: "Win risk", value: percent(s.winRisk) },
      { key: "loseRisk", label: "Lose risk", value: percent(s.loseRisk) },
    );
  }
  if (s.cuped) {
    rows.push({
      key: "cuped",
      label: "CUPED",
      value: cuped(s.cuped.enabled, s.cuped.enabled ? s.cuped.days : undefined),
    });
  }
  if (bayesian) {
    rows.push({
      key: "prior",
      label: "Prior",
      value: prior(s.prior.proper, s.prior.mean, s.prior.stddev),
    });
  }

  const overridden = new Set(
    (override ? describeMetricOverride(override) : []).map((r) => r.key),
  );
  return rows.filter((r) => !overridden.has(r.key));
}

/** The metrics an experiment actually overrides, by id. */
export function getOverriddenMetricIds(
  overrides: MetricOverride[] | undefined,
): Set<string> {
  return new Set(
    (overrides ?? [])
      .filter((o) => describeMetricOverride(o).length > 0)
      .map((o) => o.id),
  );
}
