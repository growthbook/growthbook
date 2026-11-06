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

const RATIO_CONFLICT = "Ratio metrics can't be combined with other metrics.";
const QUANTILE_CONFLICT =
  "Quantile metrics can't be combined with other metrics.";

/** Why a metric can't join a chart locked to `lockedClass`, or null if it can. */
export function getMixClassConflict(
  metricType: string | null | undefined,
  lockedClass: Exclude<MetricMixClass, "unknown"> | null,
): string | null {
  const metricClass = getMetricMixClass(metricType);
  if (!lockedClass || metricClass === lockedClass) return null;
  // Standard metrics mix freely, so name whichever side can't be combined.
  const exclusiveClass = lockedClass === "standard" ? metricClass : lockedClass;
  return exclusiveClass === "ratio" ? RATIO_CONFLICT : QUANTILE_CONFLICT;
}

/**
 * Why no metric can be added to a chart with these metric types, or null if
 * one can. Ratio and quantile metrics chart alone.
 */
export function getAddMetricConflict(
  metricTypes: (string | null | undefined)[],
): string | null {
  const classes = metricTypes.map(getMetricMixClass);
  if (classes.includes("ratio")) return RATIO_CONFLICT;
  if (classes.includes("quantile")) return QUANTILE_CONFLICT;
  return null;
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

/** What the chart's Identifier type picker shows. */
export type UnitPicker = {
  value: string | null;
  placeholder: string;
  options: string[];
  /** Why the picker is disabled, shown beneath it; null when it's enabled. */
  disabledReason: string | null;
};

/** The Identifier type picker for a metric chart, or null when no metric's unit can be chosen. */
export function getUnitPicker(
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): UnitPicker | null {
  const someMetricSupportsUnitSelection = values.some((value) =>
    metricSupportsUnitSelection(getFactMetricById(value.metricId)),
  );
  if (!someMetricSupportsUnitSelection) return null;

  const { unit, isMixed, options } = getMetricValuesUnitState(
    values,
    getFactMetricById,
    getFactTableById,
  );
  return {
    value: unit,
    placeholder: isMixed
      ? "Mixed identifier types"
      : "Select identifier type...",
    options,
    disabledReason: options.length
      ? null
      : "The Fact Tables of these metrics share no identifier type.",
  };
}

/**
 * The unit a metric card shows as read-only text. Only charts saved with mixed
 * units show one, since the picker can't display a single value for them.
 */
export function getReadOnlyUnit(
  value: MetricValue,
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string | null {
  if (!metricSupportsUnitSelection(getFactMetricById(value.metricId))) {
    return null;
  }
  const { isMixed } = getMetricValuesUnitState(
    values,
    getFactMetricById,
    getFactTableById,
  );
  return isMixed ? value.unit : null;
}
