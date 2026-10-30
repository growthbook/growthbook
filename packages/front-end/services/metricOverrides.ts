import { pickBy } from "lodash";
import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import {
  DecisionFrameworkMetricOverrides,
  LegacyMetricOverride,
} from "shared/types/experiment";
import { decimalToPercent } from "@/services/utils";

export const METRIC_OVERRIDE_COLOR = "var(--blue-9)";
// Outlines an overridden metric's chip; a border step reads alike in both modes.
export const METRIC_OVERRIDE_BORDER_COLOR = "var(--blue-a8)";

// Which setting a row is about, so an override can stand in for it.
type MetricSettingKey = "targetMDE" | "window" | "delay" | "cuped" | "prior";

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

const IGNORED = "Ignored by this experiment";

const LABELS: Record<Exclude<MetricSettingKey, "window">, string> = {
  targetMDE: "Target MDE",
  delay: "Metric delay",
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

// Experiment settings that stop an override from applying.
export interface OverrideContext {
  /** The experiment's analysis ignores conversion windows (not lookbacks). */
  conversionWindowsIgnored: boolean;
  /** The experiment runs no CUPED, whatever its metrics ask for. */
  cupedOff: boolean;
  /** The metric's own window type, which an hours-only override keeps. */
  metricWindowType?: MetricSettingsInput["windowType"];
}

// Unset fields keep the metric's own setting and aren't listed. A goal metric's
// target MDE lives in the decision framework but reads as its first override.
export function describeMetricOverride(
  o: MetricOverride,
  targetMDE?: number,
  context?: OverrideContext,
): OverrideRow[] {
  const rows: OverrideRow[] = [];

  if (targetMDE !== undefined) rows.push(row("targetMDE", percent(targetMDE)));
  if (o.windowType !== undefined || o.windowHours !== undefined) {
    // Hours alone keep the metric's own kind of window.
    const windowType = o.windowType ?? context?.metricWindowType;
    const value =
      windowType === "conversion" && context?.conversionWindowsIgnored
        ? IGNORED
        : o.windowHours !== undefined
          ? hours(o.windowHours)
          : "Default";
    rows.push(
      windowType === undefined
        ? { key: "window", label: "Metric window", value }
        : windowRow(windowType, value),
    );
  }
  if (o.delayHours !== undefined) rows.push(row("delay", hours(o.delayHours)));
  if (o.regressionAdjustmentOverride) {
    const value = cuped(
      o.regressionAdjustmentEnabled,
      o.regressionAdjustmentDays,
    );
    rows.push(
      row(
        "cuped",
        o.regressionAdjustmentEnabled && context?.cupedOff
          ? `${value} (CUPED is off for this experiment)`
          : value,
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

// How a metric is analysed in an experiment before any override of it.
export interface MetricSettingsInput {
  windowType: "conversion" | "lookback" | "" | undefined;
  windowHours: number;
  delayHours: number;
  /** The experiment's analysis ignores conversion windows (not lookbacks). */
  conversionWindowsIgnored: boolean;
  /** Left out where the organization can't use CUPED at all. */
  cuped: { enabled: boolean; days: number } | null;
  prior: { proper: boolean; mean: number; stddev: number };
  /** A goal metric's own target MDE, where the decision framework uses one. */
  targetMDE?: number;
}

// The settings the override doesn't already cover. The prior is left out under
// the frequentist engine, which ignores it.
export function describeMetricSettings(
  s: MetricSettingsInput,
  statsEngine: StatsEngine,
  override: MetricOverride | undefined,
  targetMDEOverride?: number,
): OverrideRow[] {
  const rows: OverrideRow[] = [
    ...(s.targetMDE !== undefined
      ? [row("targetMDE", percent(s.targetMDE))]
      : []),
    windowRow(
      s.windowType,
      s.windowType === "conversion" && s.conversionWindowsIgnored
        ? IGNORED
        : hours(s.windowHours),
    ),
  ];
  if (s.delayHours) rows.push(row("delay", hours(s.delayHours)));
  if (s.cuped) rows.push(row("cuped", cuped(s.cuped.enabled, s.cuped.days)));
  if (statsEngine === "bayesian") {
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

// The metrics an experiment actually overrides, by id; target MDEs count too.
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

// Keeps only what changes the analysis: CUPED and prior values count only under
// their override flag, and a metric left overriding nothing drops out.
export function pruneMetricOverrides(
  overrides: MetricOverride[],
): MetricOverride[] {
  return overrides.flatMap(
    ({
      regressionAdjustmentOverride,
      regressionAdjustmentEnabled,
      regressionAdjustmentDays,
      properPriorOverride,
      properPriorEnabled,
      properPriorMean,
      properPriorStdDev,
      ...window
    }) => {
      const kept = {
        ...pickBy(
          {
            ...window,
            ...(regressionAdjustmentOverride
              ? {
                  regressionAdjustmentOverride,
                  regressionAdjustmentEnabled,
                  regressionAdjustmentDays,
                }
              : {}),
            ...(properPriorOverride
              ? {
                  properPriorOverride,
                  properPriorEnabled,
                  properPriorMean,
                  properPriorStdDev,
                }
              : {}),
          },
          (v) => v !== undefined,
        ),
        id: window.id,
      };
      return Object.keys(kept).length > 1 ? [kept] : [];
    },
  );
}

// Goals' target MDEs as edited, in percent; an unset or emptied one follows the
// metric. Entries keep their place, and unchanged ones stay as saved, so an
// unchanged list equals the saved one. A metric that's no longer a goal keeps
// what it had.
export function mergeTargetMDEs(
  previous: DecisionFrameworkMetricOverrides[],
  goalIds: string[],
  percents: Record<string, number | undefined>,
): DecisionFrameworkMetricOverrides[] {
  const edited = (id: string): number | null => {
    const p = percents[id];
    return p === undefined || Number.isNaN(p) ? null : p;
  };
  const kept = previous.flatMap((o) => {
    if (!goalIds.includes(o.id)) return [o];
    const p = edited(o.id);
    if (p === null) return [];
    return o.targetMDE !== undefined && decimalToPercent(o.targetMDE, 11) === p
      ? [o]
      : [{ ...o, targetMDE: p / 100 }];
  });
  const added = goalIds.flatMap((id) => {
    const p = edited(id);
    return p === null || previous.some((o) => o.id === id)
      ? []
      : [{ id, targetMDE: p / 100 }];
  });
  return [...kept, ...added];
}

// Why the override editor can't change a metric, or null where it can. Goals'
// target MDEs stay editable where nothing else is, since they only change how
// finished results are judged.
export function getOverridesBlockedReason({
  hasFeature,
  incremental,
  targetMDEsEditable,
  goal,
}: {
  hasFeature: boolean;
  incremental: boolean;
  /** The decision framework runs, so goals have target MDEs. */
  targetMDEsEditable: boolean;
  goal: boolean;
}): string | null {
  if (hasFeature && !incremental) return null;
  if (goal && targetMDEsEditable) return null;
  if (!hasFeature) return "Overriding metrics is available on paid plans.";
  return targetMDEsEditable
    ? "Experiments using incremental refresh can only override goal metrics' target MDEs."
    : "Metric overrides aren't available for experiments using incremental refresh.";
}

// Drops the deprecated window and risk fields older saved overrides still
// carry, which the override schema refuses.
export function withoutDeprecatedOverrideFields(
  overrides: LegacyMetricOverride[],
): MetricOverride[] {
  return overrides.map((override) => {
    const current = { ...override };
    delete current.conversionWindowHours;
    delete current.conversionDelayHours;
    delete current.winRisk;
    delete current.loseRisk;
    return current;
  });
}
