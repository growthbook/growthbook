import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { MetricValue } from "shared/validators";
import { getFactMetricPrimaryFactTableId } from "shared/experiments";
import { getMetricMixClass } from "shared/enterprise";
import type { MetricMixClass } from "shared/enterprise";

/**
 * Given the other already-selected metrics in the dataset (excluding the slot
 * being edited), return the class any newly selected metric must match — or
 * null if any class is allowed.
 *
 * Unknown/unselected slots are ignored.
 */
export function getLockedMixClass(
  otherMetricTypes: (string | null | undefined)[],
): "ratio" | "quantile" | "standard" | null {
  for (const t of otherMetricTypes) {
    const c = getMetricMixClass(t);
    if (c !== "unknown") return c;
  }
  return null;
}

/** Why a metric can't join a chart locked to `lockedClass`, or null if it can. */
export function getMixClassConflict(
  metricType: string | null | undefined,
  lockedClass: Exclude<MetricMixClass, "unknown"> | null,
): string | null {
  const metricClass = getMetricMixClass(metricType);
  if (!lockedClass || metricClass === lockedClass) return null;
  // Standard metrics mix freely, so name whichever side can't be combined.
  const exclusiveClass = lockedClass === "standard" ? metricClass : lockedClass;
  return exclusiveClass === "ratio"
    ? "Ratio metrics can't be combined with other metric types."
    : "Quantile metrics can't be combined with other metric types.";
}

/**
 * Whether the Explorer lets a metric's counting unit be chosen. Other metrics
 * (quantiles, most ratios) keep the unit `fillMissingUnits` gives them.
 */
export function metricSupportsUnitSelection(
  metric: FactMetricInterface | null,
): boolean {
  if (!metric) return false;
  switch (metric.metricType) {
    case "mean":
    case "proportion":
    case "retention":
    case "dailyParticipation":
      return true;
    case "ratio":
      // TODO: handle separate denominator unit selector
      return metric.numerator.column === "$$distinctUsers";
    case "quantile":
    case "funnel":
      return false;
  }
}

/** Why a metric can't join a chart locked to `lockedUnit`, or null if it can. */
export function getUnitConflict(
  metric: FactMetricInterface,
  lockedUnit: string | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string | null {
  if (!lockedUnit || !metricSupportsUnitSelection(metric)) return null;
  const userIdTypes =
    getFactTableById(getFactMetricPrimaryFactTableId(metric))?.userIdTypes ??
    [];
  if (userIdTypes.includes(lockedUnit)) return null;
  return `This metric's Fact Table has no ${lockedUnit} identifier type.`;
}

/** The chart-level unit of a metric dataset, read across its values. */
export type MetricValuesUnitState = {
  /** The unit every unit-selectable value uses; null when mixed or unset. */
  unit: string | null;
  /** Values use more than one unit, e.g. a config saved before the single picker. */
  isMixed: boolean;
  /** Units offered by every metric that supports unit selection, in the first metric's order. */
  options: string[];
};

/**
 * Reads the chart-level unit from the metric values whose unit can be chosen
 * (see `metricSupportsUnitSelection`). Empty slots and unresolved metrics are
 * skipped.
 */
export function getMetricValuesUnitState(
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): MetricValuesUnitState {
  const metricsSupportingUnitSelection: FactMetricInterface[] = [];
  const selectedUnits = new Set<string>();
  for (const value of values) {
    const metric = value.metricId ? getFactMetricById(value.metricId) : null;
    if (!metric || !metricSupportsUnitSelection(metric)) continue;
    metricsSupportingUnitSelection.push(metric);
    if (value.unit) selectedUnits.add(value.unit);
  }

  const unitsOfferedByEachMetric = metricsSupportingUnitSelection.map(
    (metric) =>
      getFactTableById(getFactMetricPrimaryFactTableId(metric))?.userIdTypes ??
      [],
  );
  const [firstMetricUnits = [], ...otherMetricsUnits] =
    unitsOfferedByEachMetric;
  const unitsEveryMetricOffers = firstMetricUnits.filter((unit) =>
    otherMetricsUnits.every((units) => units.includes(unit)),
  );

  const allValuesShareOneUnit = selectedUnits.size === 1;
  return {
    unit: allValuesShareOneUnit ? [...selectedUnits][0] : null,
    isMixed: selectedUnits.size > 1,
    options: unitsEveryMetricOffers,
  };
}

/** Sets `unit` on every metric value whose unit can be chosen. */
export function setMetricValuesUnit(
  values: MetricValue[],
  unit: string,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): MetricValue[] {
  return values.map((value) =>
    metricSupportsUnitSelection(getFactMetricById(value.metricId))
      ? { ...value, unit }
      : value,
  );
}
