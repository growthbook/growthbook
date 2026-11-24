import { partition } from "lodash";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type {
  ExplorationPopulation,
  MetricDataset,
  MetricValue,
  PopulationInterface,
  ProductAnalyticsDimension,
} from "shared/validators";
import {
  getChosenUnits,
  getMetricIdentifierTypes,
  getMetricMixClass,
  getPopulationIncompatibility,
  getPopulationMetricFactTableId,
  isPopulationEligible,
  metricSupportsUnitSelection,
  parseMetricExplorationPopulation,
  resolveSavedPopulation,
} from "shared/enterprise";
import type { PopulationRuleFactTable } from "shared/populations";
import { isProjectListValidForProject } from "shared/util";
import type { MetricMixClass } from "shared/enterprise";
import type { GroupedValue, SingleValue } from "@/components/Forms/SelectField";
import { metricTypeLabel } from "@/components/Metrics/FactMetricTypeDisplayName";

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
 * Why a metric can't join a chart whose Population reads from
 * `populationFactTable`, or null if it can. Populations only support
 * proportion and mean metrics on their own Fact Table. The reason names the
 * metric's type as the type picker does, or the Fact Table to pick from.
 */
export function getPopulationConflict(
  metric: FactMetricInterface,
  populationFactTable: { id: string; name: string | null },
  getFactTableById: (id: string) => FactTableDefinition | null,
): string | null {
  const { id, name } = populationFactTable;
  const incompatibility = getPopulationIncompatibility(metric, id);
  switch (incompatibility) {
    case null:
      return null;
    case "metricType":
      return `${metricTypeLabel(metric, getFactTableById)} metrics can't be combined with a Population.`;
    case "percentileCap":
      return "Metrics with percentile capping can't be combined with a Population. Use an absolute cap or no cap instead.";
    case "factTable":
      return name
        ? `Charts with this Population only support metrics on the ${name} Fact Table.`
        : "This metric doesn't use the Population's Fact Table.";
    default: {
      const unhandled: never = incompatibility;
      throw new Error(`Unhandled Population incompatibility: ${unhandled}`);
    }
  }
}

/** Why a metric can't join a chart locked to `lockedUnit`, or null if it can. */
export function getUnitConflict(
  metric: FactMetricInterface,
  lockedUnit: string | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string | null {
  if (!lockedUnit || !metricSupportsUnitSelection(metric)) return null;
  if (getMetricIdentifierTypes(metric, getFactTableById).includes(lockedUnit))
    return null;
  return `This metric's Fact Table has no ${lockedUnit} identifier type. Change the identifier type below to use it.`;
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
 * (see `getChosenUnits`), and the units the picker can offer.
 */
export function getMetricValuesUnitState(
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): MetricValuesUnitState {
  const unitsOfferedByEachMetric = values.flatMap((value) => {
    const metric = getFactMetricById(value.metricId);
    if (!metric || !metricSupportsUnitSelection(metric)) return [];
    return [getMetricIdentifierTypes(metric, getFactTableById)];
  });
  const [firstMetricUnits = [], ...otherMetricsUnits] =
    unitsOfferedByEachMetric;
  const unitsEveryMetricOffers = firstMetricUnits.filter((unit) =>
    otherMetricsUnits.every((units) => units.includes(unit)),
  );

  const chosenUnits = getChosenUnits(values, getFactMetricById);
  return {
    unit: chosenUnits.length === 1 ? chosenUnits[0] : null,
    isMixed: chosenUnits.length > 1,
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
  { unit, isMixed, options }: MetricValuesUnitState,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): UnitPicker | null {
  const someMetricSupportsUnitSelection = values.some((value) =>
    metricSupportsUnitSelection(getFactMetricById(value.metricId)),
  );
  if (!someMetricSupportsUnitSelection) return null;

  return {
    value: unit,
    placeholder: isMixed
      ? "Mixed identifier types"
      : "Select identifier type...",
    options,
    disabledReason: options.length
      ? null
      : "These metrics' Fact Tables share no identifier type. Remove or change a metric to pick one.",
  };
}

/**
 * The unit a metric card shows as read-only text. Only charts saved with mixed
 * units show one, since the picker can't display a single value for them.
 */
export function getReadOnlyUnit(
  value: MetricValue,
  unitsAreMixed: boolean,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string | null {
  if (!unitsAreMixed) return null;
  return metricSupportsUnitSelection(getFactMetricById(value.metricId))
    ? value.unit
    : null;
}

/**
 * The Fact Table a Population must read from to be combined with these
 * metrics, or null when they can't take one. Populations only support
 * proportion and uncapped-by-percentile mean metrics, and every metric must
 * share the Population's Fact Table. Empty slots and metrics that haven't
 * loaded yet are skipped, so they don't hide the picker; null when no loaded
 * metric is left.
 */
export function getPopulationFactTableId(
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string | null {
  let sharedFactTableId: string | null = null;
  for (const value of values) {
    if (!value.metricId) continue;
    const metric = getFactMetricById(value.metricId);
    // Unknown until it loads, which isn't the same as incompatible.
    if (!metric) continue;
    if (!isPopulationEligible(metric)) return null;
    const factTableId = getPopulationMetricFactTableId(metric);
    if (sharedFactTableId === null) {
      sharedFactTableId = factTableId;
    } else if (factTableId !== sharedFactTableId) {
      return null;
    }
  }
  return sharedFactTableId;
}

/**
 * Whether a saved Population can be offered for a metric chart: it's in the
 * current Project, the query would accept it (`resolveSavedPopulation`: the
 * chart's Data Source, a single step, the chart's identifier type, or any
 * when none is chosen yet), and its step reads from the metrics' shared Fact
 * Table.
 */
export function populationFitsMetricChart(
  candidate: Pick<
    PopulationInterface,
    "id" | "projects" | "datasource" | "userIdTypes" | "steps"
  >,
  chart: {
    project: string;
    datasource: string;
    /** The metrics' shared Fact Table; null when they don't share one. */
    factTableId: string | null;
    unit: string | null;
  },
): boolean {
  if (!isProjectListValidForProject(candidate.projects, chart.project)) {
    return false;
  }
  const units = chart.unit ? [chart.unit] : candidate.userIdTypes;
  return units.some((unit) => {
    const resolved = resolveSavedPopulation({
      population: { populationId: candidate.id, unit },
      savedPopulation: candidate,
      datasource: chart.datasource,
    });
    return (
      resolved.ok &&
      resolved.population.source.factTableId === chart.factTableId
    );
  });
}

/**
 * Why a metric chart's Population can't be used, for the editor. Values
 * without a metric chosen yet are skipped.
 */
export function getMetricChartPopulationViolations({
  population,
  savedPopulation,
  values,
  dimensions,
  datasource,
  getFactMetricById,
  factTables,
}: {
  population: ExplorationPopulation;
  /** Null when the saved Population was deleted or can't be read. */
  savedPopulation: Pick<
    PopulationInterface,
    "datasource" | "userIdTypes" | "steps"
  > | null;
  values: MetricDataset["values"];
  dimensions: ProductAnalyticsDimension[];
  datasource: string;
  getFactMetricById: (id: string) => FactMetricInterface | null;
  factTables: PopulationRuleFactTable[];
}): string[] {
  if (!savedPopulation) {
    return [
      "This Population was deleted or you don't have access to it. Choose another Population or None.",
    ];
  }
  const chosenValues = values.filter((value) => value.metricId);
  const metricMap = new Map<string, FactMetricInterface>();
  for (const value of chosenValues) {
    const metric = getFactMetricById(value.metricId);
    if (metric) metricMap.set(metric.id, metric);
  }
  const parsed = parseMetricExplorationPopulation({
    population,
    savedPopulation,
    values: chosenValues,
    dimensions,
    datasource,
    metricMap,
    factTableMap: new Map(factTables.map((table) => [table.id, table])),
  });
  return parsed.ok ? [] : parsed.violations;
}

/**
 * Moves the enabled options ahead of the disabled ones, within each group and
 * otherwise keeping their order.
 */
export function orderEnabledOptionsFirst(
  options: (SingleValue | GroupedValue)[],
  isDisabled: (value: string) => boolean,
): (SingleValue | GroupedValue)[] {
  const enabledFirst = (opts: SingleValue[]) =>
    partition(opts, (o) => !isDisabled(o.value)).flat();
  return options.some((o) => "options" in o)
    ? options.map((o) =>
        "options" in o ? { ...o, options: enabledFirst(o.options) } : o,
      )
    : enabledFirst(options as SingleValue[]);
}
