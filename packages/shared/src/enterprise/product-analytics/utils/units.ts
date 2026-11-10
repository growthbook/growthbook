import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import { getFactMetricPrimaryFactTableId } from "../../../experiments/experiments";
import type {
  ExplorationConfig,
  MetricValue,
} from "../../../validators/product-analytics";

/**
 * Whether a metric's counting unit can be chosen. Other metrics (quantiles,
 * most ratios) keep the unit `fillMissingUnits` gives them.
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

/** The identifier types a metric's unit can be: those of its primary fact table. */
export function getMetricIdentifierTypes(
  metric: FactMetricInterface,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string[] {
  return (
    getFactTableById(getFactMetricPrimaryFactTableId(metric))?.userIdTypes ?? []
  );
}

/**
 * The distinct units chosen on metric values whose unit can be chosen (see
 * `metricSupportsUnitSelection`). Other values' units don't count toward the
 * chart's unit. Empty slots and unresolved metrics are skipped.
 */
export function getChosenUnits(
  values: MetricValue[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string[] {
  const units = new Set<string>();
  for (const value of values) {
    const metric = value.metricId ? getFactMetricById(value.metricId) : null;
    if (metricSupportsUnitSelection(metric) && value.unit)
      units.add(value.unit);
  }
  return [...units];
}

/**
 * The one unit every unit-selectable value of a metric dataset uses, otherwise
 * null. Used to label "Per <unit>" and to fill missing units.
 */
export function getSharedUnit(
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string | null {
  if (!config?.dataset || config.dataset.type !== "metric") return null;
  const units = getChosenUnits(config.dataset.values, getFactMetricById);
  return units.length === 1 ? units[0] : null;
}

/**
 * Fills in a default `unit` for metric values that have a resolved metric but
 * no unit selected. Defaults to the chart's unit (see `getSharedUnit`) when
 * the metric's fact table has it, else the fact table's first userIdType.
 *
 * Without a unit, the SQL layer doesn't emit a denominator column, which breaks
 * the per_unit branch of the showAs toggle and silently degrades ratio-like
 * metrics. Applied when loading a config from any source (URL, AI agent, saved
 * exploration) so users don't end up in that state.
 *
 * Skips:
 * - fact_table / data_source datasets (their unit semantics are user-driven).
 * - Metric values whose unit is already set.
 * - Metric values whose metricId is empty or can't be resolved.
 * - Metrics whose fact table has no userIdTypes (nothing to default to).
 */
export function fillMissingUnits(
  config: ExplorationConfig,
  getFactTableById: (id: string) => FactTableDefinition | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationConfig {
  if (!config.dataset) return config;

  if (config.dataset.type === "funnel") {
    // Funnels store unit at the dataset level (not per-step). Default to the
    // first userIdType that exists on every step's fact table.
    if (config.dataset.unit) return config;
    const steps = config.dataset.steps;
    if (!steps.length) return config;
    const factTables = steps
      .map((s) => (s.factTableId ? getFactTableById(s.factTableId) : null))
      .filter((ft): ft is FactTableDefinition => !!ft);
    if (factTables.length !== steps.length) return config;
    const intersection = factTables.reduce<string[] | null>((acc, ft) => {
      const ids = ft.userIdTypes ?? [];
      if (acc === null) return [...ids];
      return acc.filter((id) => ids.includes(id));
    }, null);
    const defaultUnit = intersection?.[0];
    if (!defaultUnit) return config;
    return {
      ...config,
      dataset: { ...config.dataset, unit: defaultUnit },
    } as ExplorationConfig;
  }

  // Narrow on config.type, not config.dataset.type — only the former
  // discriminates ExplorationConfig, so the spread below stays type-safe
  // instead of needing an `as ExplorationConfig`.
  if (config.type === "journey") {
    const current = config.dataset;
    if (current.unit || !current.factTableId) return config;
    const unit =
      getFactTableById(current.factTableId)?.userIdTypes?.[0] ?? null;
    if (unit === current.unit) return config;
    return { ...config, dataset: { ...current, unit } };
  }

  if (config.dataset.type !== "metric") return config;

  // Prefer the unit the other metrics already share, so filling a gap doesn't
  // mix units on a chart that has a single one.
  const sharedUnit = getSharedUnit(config, getFactMetricById);

  let changed = false;
  const newValues = config.dataset.values.map((v) => {
    if (v.unit || !v.metricId) return v;
    const metric = getFactMetricById(v.metricId);
    if (!metric) return v;
    const identifierTypes = getMetricIdentifierTypes(metric, getFactTableById);
    const defaultUnit =
      sharedUnit && identifierTypes.includes(sharedUnit)
        ? sharedUnit
        : identifierTypes[0];
    if (!defaultUnit) return v;
    changed = true;
    return { ...v, unit: defaultUnit };
  });

  if (!changed) return config;
  return {
    ...config,
    dataset: { ...config.dataset, values: newValues },
  } as ExplorationConfig;
}
