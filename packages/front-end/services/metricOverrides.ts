import { MetricOverride } from "shared/validators";

export interface OverrideRow {
  label: string;
  value: string;
}

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(4))}%`;

const hours = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;

/**
 * An experiment's override of one metric, as the rows a person reads. A field
 * left unset keeps the metric's own setting, so it isn't listed.
 */
export function describeMetricOverride(o: MetricOverride): OverrideRow[] {
  const rows: OverrideRow[] = [];

  if (o.windowType !== undefined) {
    if (o.windowType === "") {
      rows.push({ label: "Metric window", value: "None" });
    } else {
      rows.push({
        label:
          o.windowType === "conversion"
            ? "Conversion window"
            : "Lookback window",
        value: o.windowHours !== undefined ? hours(o.windowHours) : "Default",
      });
    }
  }
  if (o.delayHours !== undefined) {
    rows.push({ label: "Metric delay", value: hours(o.delayHours) });
  }
  if (o.winRisk !== undefined) {
    rows.push({ label: "Win risk", value: percent(o.winRisk) });
  }
  if (o.loseRisk !== undefined) {
    rows.push({ label: "Lose risk", value: percent(o.loseRisk) });
  }
  if (o.regressionAdjustmentOverride) {
    rows.push({
      label: "CUPED",
      value: o.regressionAdjustmentEnabled
        ? o.regressionAdjustmentDays !== undefined
          ? `On, ${o.regressionAdjustmentDays} day lookback`
          : "On"
        : "Off",
    });
  }
  if (o.properPriorOverride) {
    rows.push({
      label: "Prior",
      value: o.properPriorEnabled
        ? `Proper (mean ${o.properPriorMean ?? 0}, sd ${o.properPriorStdDev ?? 1})`
        : "Improper",
    });
  }

  return rows;
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
