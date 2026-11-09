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

/**
 * How a value renders when its metric type offers no Show as options: its raw
 * value. Ratios ignore it and always render numerator / denominator.
 */
const NO_SHOW_AS_CHOICE_DEFAULT: ShowAs = "total";

/**
 * The Show as options each metric type offers, in display order. A type that
 * isn't listed offers no choice and renders as `NO_SHOW_AS_CHOICE_DEFAULT`.
 *
 * - mean: the numerator sums each unit's value, so dividing by the unit count
 *   gives a real per-unit average.
 * - proportion / retention / dailyParticipation: not listed. They emit one row
 *   per qualifying unit, so the unit count equals the numerator and per unit
 *   would always be ~1. Proportions get options only with a population (see
 *   `SHOW_AS_OPTIONS_WITH_POPULATION`).
 * - ratio / quantile: not listed. Ratios already divide by their own
 *   denominator, and quantiles emit no denominator.
 */
const SHOW_AS_OPTIONS_BY_METRIC_TYPE: Partial<
  Record<FactMetricType, readonly ShowAs[]>
> = {
  mean: ["total", "per_unit"],
};

/**
 * The Show as options a metric type offers when the dataset has a population.
 * A proportion's converting units can then be shown as a share of the
 * population's members.
 */
const SHOW_AS_OPTIONS_WITH_POPULATION: Partial<
  Record<FactMetricType, readonly ShowAs[]>
> = {
  proportion: ["total", "percent_of_population"],
};

/** The Show as options a metric type offers; empty when it offers none. */
export function getShowAsOptions(
  metricType: FactMetricType | undefined,
  hasPopulation: boolean,
): readonly ShowAs[] {
  if (!metricType) return [];
  if (hasPopulation) {
    const populationOptions = SHOW_AS_OPTIONS_WITH_POPULATION[metricType];
    if (populationOptions) return populationOptions;
  }
  return SHOW_AS_OPTIONS_BY_METRIC_TYPE[metricType] ?? [];
}

/** Whether a config's metric dataset has a population. */
export function configHasPopulation(config: ExplorationConfig | null): boolean {
  if (config?.dataset.type !== "metric") return false;
  return config.dataset.population !== undefined;
}

/** How one dataset value renders, and which Show as options it offers. */
export type ShowAsChoice = {
  /** Empty when the value's metric type offers no choice. */
  options: readonly ShowAs[];
  showAs: ShowAs;
};

const NO_SHOW_AS_CHOICE: ShowAsChoice = {
  options: [],
  showAs: NO_SHOW_AS_CHOICE_DEFAULT,
};

/** The parts of a metric definition that decide how its values can render. */
type ShowAsMetric = Pick<FactMetricInterface, "metricType" | "numerator">;

/**
 * The definition a metric value renders: its unsaved draft in the metric
 * editor preview, otherwise the saved metric. Null while definitions load.
 */
export function getDraftOrSavedMetric(
  value: MetricValue,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ShowAsMetric | null {
  return value.draftMetric ?? getFactMetricById(value.metricId);
}

/**
 * The default `showAs` for a value without an explicit choice:
 * - `per_unit` for mean metrics whose total is incoherent — numerator
 *   aggregation `max` (a sum of per-unit maxes has no interpretation) or
 *   `count distinct` (double-counts values shared across units).
 * - `percent_of_population` for proportions when the dataset has a
 *   population, since a share of its members is what a population is for.
 * - Otherwise `total`.
 */
export function inferShowAs(
  metric: ShowAsMetric | null,
  hasPopulation: boolean,
): ShowAs {
  if (metric?.metricType === "proportion" && hasPopulation) {
    return "percent_of_population";
  }
  if (metric?.metricType === "mean") {
    const agg = metric.numerator?.aggregation ?? "sum";
    return agg === "max" || agg === "count distinct" ? "per_unit" : "total";
  }
  return NO_SHOW_AS_CHOICE_DEFAULT;
}

/**
 * Returns the showAs options and selected mode for a metric value.
 *
 */
export function getShowAsChoice(
  value: ProductAnalyticsValue,
  legacyShowAs: ShowAs | undefined,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  hasPopulation: boolean,
): ShowAsChoice {
  if (value.type !== "metric") return NO_SHOW_AS_CHOICE;
  const metric = getDraftOrSavedMetric(value, getFactMetricById);
  const options = getShowAsOptions(metric?.metricType, hasPopulation);
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
 * never claims a mode that won't render. Values whose metric hasn't resolved
 * yet keep theirs until their options are known. Call it alongside the other
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
  // Removing the population strips `percent_of_population` from its values.
  const hasPopulation = configHasPopulation(config);
  let valuesChanged = false;

  const values = config.dataset.values.map((value): MetricValue => {
    const showAs = value.showAs ?? legacyShowAs;
    if (showAs === undefined) return value;

    const metric = getDraftOrSavedMetric(value, getFactMetricById);
    // No metric yet (not picked, or definitions still loading): its options
    // are unknown, so keep the choice rather than lose it.
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
