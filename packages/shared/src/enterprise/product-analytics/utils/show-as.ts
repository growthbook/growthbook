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

/** The parts of a metric definition that decide how its values can render. */
type ShowAsMetric = Pick<FactMetricInterface, "metricType" | "numerator">;

/** How a metric type's values can render. */
type MetricTypeShowAs = {
  /** Modes without a population, in display order. */
  options: readonly ShowAs[];
  /**
   * Modes a population adds after `options`. Each divides by the row's
   * population member count.
   */
  populationOptions: readonly ShowAs[];
  /**
   * The mode until the user picks one, without a population; null when there
   * are no options, so the value renders its raw value.
   */
  getDefaultShowAs: (metric: ShowAsMetric) => ShowAs | null;
  /**
   * The default with a population, over `getDefaultShowAs`: measuring its
   * members is what a population is for. Null keeps `getDefaultShowAs`.
   */
  populationDefaultShowAs: ShowAs | null;
};

const NO_SHOW_AS: MetricTypeShowAs = {
  options: [],
  populationOptions: [],
  getDefaultShowAs: () => null,
  populationDefaultShowAs: null,
};

/**
 * Every metric type's Show as modes and defaults.
 *
 * If you change a default, also update the two places that describe them in
 * words:
 * - the DEFAULT rules in the AI agent's prompt (`show_as_rules` in
 *   back-end/src/enterprise/services/product-analytics-agent.ts)
 * - the `showAs` description in shared/src/validators/product-analytics.ts,
 *   which is published in the REST API docs
 */
const SHOW_AS_BY_METRIC_TYPE: Record<FactMetricType, MetricTypeShowAs> = {
  // The numerator sums each unit's value, so dividing by the unit count gives
  // a real per-unit average. With a population, its total averages over every
  // member, counting members without events as 0.
  mean: {
    options: ["total", "per_unit"],
    populationOptions: ["per_population_member"],
    // A total is incoherent for `max` (a sum of per-unit maxes has no
    // interpretation) and `count distinct` (double-counts values shared
    // across units).
    getDefaultShowAs: ({ numerator }) => {
      const agg = numerator?.aggregation ?? "sum";
      return agg === "max" || agg === "count distinct" ? "per_unit" : "total";
    },
    populationDefaultShowAs: "per_population_member",
  },
  // A count of converting units. Each unit counts once, so per unit would
  // always be 1. With a population, it's a share of the members.
  proportion: {
    options: ["total"],
    populationOptions: ["percent_of_population"],
    getDefaultShowAs: () => "total",
    populationDefaultShowAs: "percent_of_population",
  },
  // A count of retained units, like a proportion.
  retention: {
    options: ["total"],
    populationOptions: [],
    getDefaultShowAs: () => "total",
    populationDefaultShowAs: null,
  },
  // Each unit's active days, summed.
  dailyParticipation: {
    options: ["total"],
    populationOptions: [],
    getDefaultShowAs: () => "total",
    populationDefaultShowAs: null,
  },
  // Ratios render numerator / denominator.
  ratio: NO_SHOW_AS,
  // Quantiles render a percentile.
  quantile: NO_SHOW_AS,
  // Explorations can't chart these.
  funnel: NO_SHOW_AS,
  compound: NO_SHOW_AS,
};

/** The Show as modes a metric type renders in; empty when it has none. */
export function getShowAsOptions(
  metricType: FactMetricType | undefined,
  hasPopulation: boolean,
): readonly ShowAs[] {
  if (!metricType) return [];
  const { options, populationOptions } = SHOW_AS_BY_METRIC_TYPE[metricType];
  return hasPopulation ? [...options, ...populationOptions] : options;
}

/** Whether a mode divides by the row's population member count. */
export function dividesByPopulationCount(
  showAs: ShowAs | null | undefined,
): boolean {
  if (!showAs) return false;
  return Object.values(SHOW_AS_BY_METRIC_TYPE).some(({ populationOptions }) =>
    populationOptions.includes(showAs),
  );
}

/**
 * A mode's display name, shared by the Show as picker, the axis title and the
 * series names, e.g. "Per user_id" or "% of Population".
 */
export function getShowAsLabel(showAs: ShowAs, unit: string | null): string {
  switch (showAs) {
    case "total":
      return "Total";
    case "per_unit":
      return unit ? `Per ${unit}` : "Per unit";
    case "percent_of_population":
      return "% of Population";
    case "per_population_member":
      return "Per Population member";
    default: {
      const exhaustiveCheck: never = showAs;
      return exhaustiveCheck;
    }
  }
}

/** How one dataset value renders, and which Show as modes it offers. */
export type ShowAsChoice = {
  /** Empty when the value's metric type has no modes. */
  options: readonly ShowAs[];
  /** Null when there are no options: the value renders its raw value. */
  showAs: ShowAs | null;
};

const NO_SHOW_AS_CHOICE: ShowAsChoice = {
  options: [],
  showAs: null,
};

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
 * The default `showAs` for a value without an explicit choice, from
 * `SHOW_AS_BY_METRIC_TYPE`.
 */
export function inferShowAs(
  metric: ShowAsMetric | null,
  hasPopulation: boolean,
): ShowAs | null {
  if (!metric) return null;
  const { getDefaultShowAs, populationDefaultShowAs } =
    SHOW_AS_BY_METRIC_TYPE[metric.metricType];
  if (hasPopulation && populationDefaultShowAs !== null) {
    return populationDefaultShowAs;
  }
  return getDefaultShowAs(metric);
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
        candidate !== undefined &&
        candidate !== null &&
        options.includes(candidate),
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
