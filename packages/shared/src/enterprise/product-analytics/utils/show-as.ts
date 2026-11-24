import { omit } from "lodash";
import type {
  FactMetricInterface,
  FactMetricType,
} from "shared/types/fact-table";
import type {
  ExplorationConfig,
  MetricValue,
  ProductAnalyticsValue,
  ShowAs,
} from "../../../validators/product-analytics";
import { configHasPopulation } from "../populations";

/**
 * How a value renders when its metric type has no Show as modes: its raw
 * value. Ratios ignore it and always render numerator / denominator.
 */
const NO_SHOW_AS_CHOICE_DEFAULT: ShowAs = "total";

/**
 * The Show as modes each metric type renders in without a population, in
 * display order. A type with no modes renders as `NO_SHOW_AS_CHOICE_DEFAULT`.
 *
 * - mean: the numerator sums each unit's value, so dividing by the unit count
 *   gives a real per-unit average.
 * - proportion / retention: a count of converting units. Each unit counts
 *   once, so per unit would always be 1.
 * - dailyParticipation: each unit's active days, summed.
 * - ratio: none. Ratios render numerator / denominator.
 * - quantile: none. Quantiles render a percentile.
 * - funnel / compound: none. Explorations can't chart them.
 */
const SHOW_AS_OPTIONS_BY_METRIC_TYPE: Record<
  FactMetricType,
  readonly ShowAs[]
> = {
  mean: ["total", "per_unit"],
  proportion: ["total"],
  retention: ["total"],
  dailyParticipation: ["total"],
  ratio: [],
  quantile: [],
  funnel: [],
  compound: [],
};

/**
 * The modes a population adds after a type's own. Each one divides by the
 * row's population member count: a proportion's converting units as a share
 * of the members, and a mean's total as an average over every member,
 * counting members without events as 0.
 */
const POPULATION_SHOW_AS_OPTIONS_BY_METRIC_TYPE: Partial<
  Record<FactMetricType, readonly ShowAs[]>
> = {
  mean: ["per_population_member"],
  proportion: ["percent_of_population"],
};

/** The Show as modes a metric type renders in; empty when it has none. */
export function getShowAsOptions(
  metricType: FactMetricType | undefined,
  hasPopulation: boolean,
): readonly ShowAs[] {
  if (!metricType) return [];
  const options = SHOW_AS_OPTIONS_BY_METRIC_TYPE[metricType];
  if (!hasPopulation) return options;
  const populationOptions =
    POPULATION_SHOW_AS_OPTIONS_BY_METRIC_TYPE[metricType] ?? [];
  return [...options, ...populationOptions];
}

/** Whether a mode divides by the row's population member count. */
export function dividesByPopulationCount(
  showAs: ShowAs | null | undefined,
): boolean {
  if (!showAs) return false;
  return Object.values(POPULATION_SHOW_AS_OPTIONS_BY_METRIC_TYPE).some(
    (populationOptions) => populationOptions?.includes(showAs),
  );
}

/** How one dataset value renders, and which Show as modes it offers. */
export type ShowAsChoice = {
  /** Empty when the value's metric type has no modes. */
  options: readonly ShowAs[];
  showAs: ShowAs;
};

/**
 * Whether the user picks between modes. A value with a single mode renders in
 * it without a picker. The one place that decides whether a picker shows.
 */
export function hasShowAsChoice(options: readonly ShowAs[]): boolean {
  return options.length > 1;
}

const NO_SHOW_AS_CHOICE: ShowAsChoice = {
  options: [],
  showAs: NO_SHOW_AS_CHOICE_DEFAULT,
};

/** The parts of a metric definition that decide how its values can render. */
type ShowAsMetric = Pick<FactMetricInterface, "metricType" | "numerator">;

/**
 * The definition a metric value renders: its unsaved draft in the metric
 * editor preview, otherwise the saved metric. Null when no metric is picked
 * or its id isn't found (e.g. the metric was deleted).
 */
export function getDraftOrSavedMetric(
  value: MetricValue,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAsMetric | null {
  return value.draftMetric ?? getFactMetricById(value.metricId);
}

/**
 * The default `showAs` for a value without an explicit choice:
 * - `percent_of_population` for proportions and `per_population_member` for
 *   means when the dataset has a population, since measuring its members is
 *   what a population is for.
 * - `per_unit` for other mean metrics whose total is incoherent — numerator
 *   aggregation `max` (a sum of per-unit maxes has no interpretation) or
 *   `count distinct` (double-counts values shared across units).
 * - Otherwise `total`.
 */
export function inferShowAs(
  metric: ShowAsMetric | null,
  hasPopulation: boolean,
): ShowAs {
  if (metric?.metricType === "proportion" && hasPopulation) {
    return "percent_of_population";
  }
  if (metric?.metricType === "mean" && hasPopulation) {
    return "per_population_member";
  }
  if (metric?.metricType === "mean") {
    const agg = metric.numerator?.aggregation ?? "sum";
    return agg === "max" || agg === "count distinct" ? "per_unit" : "total";
  }
  return NO_SHOW_AS_CHOICE_DEFAULT;
}

/**
 * Returns the showAs options and selected mode for a metric value. A value
 * whose metric isn't found renders its saved choice, the one
 * `normalizeShowAs` keeps for it, as the only option.
 */
export function getShowAsChoice(
  value: ProductAnalyticsValue,
  legacyShowAs: ShowAs | undefined,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  hasPopulation: boolean,
): ShowAsChoice {
  if (value.type !== "metric") return NO_SHOW_AS_CHOICE;
  const metric = getDraftOrSavedMetric(value, getFactMetricById);
  if (metric === null) {
    // The other options depend on the metric type, which is unknown without
    // the metric.
    const showAs = value.showAs ?? legacyShowAs;
    if (value.metricId && showAs !== undefined) {
      return { options: [showAs], showAs };
    }
    return NO_SHOW_AS_CHOICE;
  }
  const options = getShowAsOptions(metric.metricType, hasPopulation);
  if (!options.length) return NO_SHOW_AS_CHOICE;
  const showAs =
    [value.showAs, legacyShowAs, inferShowAs(metric, hasPopulation)].find(
      (candidate): candidate is ShowAs =>
        candidate !== undefined && options.includes(candidate),
    ) ?? options[0];
  return { options, showAs };
}

/**
 * Write-time counterpart to `getShowAsChoice`: moves the deprecated
 * config-level `showAs` onto the metric values that offer it as an option and
 * strips `showAs` that isn't one of the value's options, so a stored config
 * never claims a mode that won't render. Values whose metric isn't found keep
 * theirs, since their options are unknown. Call it alongside the other
 * write-time normalizers (validateDimensions, fillMissingUnits).
 *
 * Returns the same reference when nothing changed so callers can use identity
 * comparisons to avoid unnecessary re-renders.
 */
export function normalizeShowAs<T extends ExplorationConfig>(
  config: T,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): T {
  // Other dataset types don't support showAs.
  if (config.dataset.type !== "metric") return config;

  const legacyShowAs = config.showAs;
  const hasLegacyShowAs = legacyShowAs !== undefined;
  // Removing the population strips its modes from its values.
  const hasPopulation = configHasPopulation(config);
  let valuesChanged = false;

  const values = config.dataset.values.map((value): MetricValue => {
    const showAs = value.showAs ?? legacyShowAs;
    if (showAs === undefined) return value;

    const metric = getDraftOrSavedMetric(value, getFactMetricById);
    // No metric (not picked, or its id isn't found): its options are
    // unknown, so keep the choice rather than lose it.
    const optionsAreUnknown = metric === null;
    const metricOffersShowAs =
      metric !== null &&
      getShowAsOptions(metric.metricType, hasPopulation).includes(showAs);
    const keepShowAs = optionsAreUnknown || metricOffersShowAs;
    const alreadyStored = value.showAs === showAs;

    if (keepShowAs && alreadyStored) return value;
    valuesChanged = true;
    if (keepShowAs) return { ...value, showAs };
    return omit(value, "showAs");
  });

  if (!hasLegacyShowAs && !valuesChanged) return config;
  return {
    ...omit(config, "showAs"),
    dataset: { ...config.dataset, values },
  } as T;
}
