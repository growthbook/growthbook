import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import {
  DecisionFrameworkMetricOverrides,
  LegacyMetricOverride,
} from "shared/types/experiment";

export const METRIC_OVERRIDE_COLOR = "var(--blue-9)";
// Outlines an overridden metric's chip; a border step reads alike in both modes.
export const METRIC_OVERRIDE_BORDER_COLOR = "var(--blue-a8)";

/** Which setting a row is about, so an override can stand in for it. */
type MetricSettingKey =
  | "targetMDE"
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

const LABELS: Record<Exclude<MetricSettingKey, "window">, string> = {
  targetMDE: "Target MDE",
  delay: "Metric delay",
  winRisk: "Win risk",
  loseRisk: "Lose risk",
  cuped: "CUPED",
  prior: "Prior",
};

const row = (
  key: Exclude<MetricSettingKey, "window">,
  value: string,
): OverrideRow => ({ key, label: LABELS[key], value });

// A metric with no window reads "None", whatever its hours.
const windowRow = (
  windowType: MetricSettingsInput["windowType"],
  value: string,
): OverrideRow =>
  windowType
    ? {
        key: "window",
        label:
          windowType === "conversion" ? "Conversion window" : "Lookback window",
        value,
      }
    : { key: "window", label: "Metric window", value: "None" };

/**
 * A field left unset keeps the metric's own setting, so it isn't listed. A goal
 * metric's target MDE is kept apart from the rest by the decision framework,
 * but reads as the first of its overrides.
 */
export function describeMetricOverride(
  o: MetricOverride,
  targetMDE?: number,
): OverrideRow[] {
  const rows: OverrideRow[] = [];

  if (targetMDE !== undefined) rows.push(row("targetMDE", percent(targetMDE)));
  if (o.windowType !== undefined) {
    rows.push(
      windowRow(
        o.windowType,
        o.windowHours !== undefined ? hours(o.windowHours) : "Default",
      ),
    );
  }
  if (o.delayHours !== undefined) rows.push(row("delay", hours(o.delayHours)));
  if (o.winRisk !== undefined) rows.push(row("winRisk", percent(o.winRisk)));
  if (o.loseRisk !== undefined) rows.push(row("loseRisk", percent(o.loseRisk)));
  if (o.regressionAdjustmentOverride) {
    rows.push(
      row(
        "cuped",
        cuped(o.regressionAdjustmentEnabled, o.regressionAdjustmentDays),
      ),
    );
  }
  if (o.properPriorOverride) {
    rows.push(
      row(
        "prior",
        prior(o.properPriorEnabled, o.properPriorMean, o.properPriorStdDev),
      ),
    );
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
  /** A goal metric's own target MDE, where the decision framework uses one. */
  targetMDE?: number;
}

/**
 * The settings the override doesn't already cover. Bayesian-only settings are
 * left out under the frequentist engine, which ignores them.
 */
export function describeMetricSettings(
  s: MetricSettingsInput,
  statsEngine: StatsEngine,
  override: MetricOverride | undefined,
  targetMDEOverride?: number,
): OverrideRow[] {
  const bayesian = statsEngine === "bayesian";
  const rows: OverrideRow[] = [
    ...(s.targetMDE !== undefined
      ? [row("targetMDE", percent(s.targetMDE))]
      : []),
    windowRow(
      s.windowType,
      s.windowType === "conversion" && s.conversionWindowsIgnored
        ? "Ignored by this experiment"
        : hours(s.windowHours),
    ),
  ];
  if (s.delayHours) rows.push(row("delay", hours(s.delayHours)));
  if (bayesian) {
    rows.push(
      row("winRisk", percent(s.winRisk)),
      row("loseRisk", percent(s.loseRisk)),
    );
  }
  if (s.cuped) rows.push(row("cuped", cuped(s.cuped.enabled, s.cuped.days)));
  if (bayesian) {
    rows.push(
      row("prior", prior(s.prior.proper, s.prior.mean, s.prior.stddev)),
    );
  }

  const overridden = new Set(
    describeMetricOverride(override ?? { id: "" }, targetMDEOverride).map(
      (r) => r.key,
    ),
  );
  return rows.filter((r) => !overridden.has(r.key));
}

/** The metrics an experiment actually overrides, by id; target MDEs count too. */
export function getOverriddenMetricIds(
  overrides: MetricOverride[] | undefined,
  targetMDEOverrides: DecisionFrameworkMetricOverrides[] = [],
): Set<string> {
  return new Set([
    ...(overrides ?? [])
      .filter((o) => describeMetricOverride(o).length > 0)
      .map((o) => o.id),
    ...targetMDEOverrides
      .filter((o) => o.targetMDE !== undefined)
      .map((o) => o.id),
  ]);
}

/**
 * Drops the window fields older saved overrides still carry alongside their
 * replacements, which the override schema refuses.
 */
export function withoutDeprecatedOverrideFields(
  overrides: LegacyMetricOverride[],
): MetricOverride[] {
  return overrides.map((override) => {
    const current = { ...override };
    delete current.conversionWindowHours;
    delete current.conversionDelayHours;
    return current;
  });
}
