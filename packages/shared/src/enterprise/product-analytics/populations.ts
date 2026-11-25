import type {
  ExplorationConfig,
  ExplorationPopulation,
  MetricDataset,
  PopulationInterface,
  ProductAnalyticsDimension,
  ResolvedExplorationPopulation,
} from "shared/validators";
import {
  getPopulationRuleViolations,
  getSinglePopulationStep,
  type PopulationRuleFactTable,
} from "shared/populations";
import type {
  FactMetricInterface,
  FactMetricType,
} from "shared/types/fact-table";
import {
  getCappingTailState,
  isCappableFactMetric,
} from "../../validators/fact-table";

export function configHasPopulation(config: ExplorationConfig | null): boolean {
  if (config?.dataset.type !== "metric") return false;
  return config.dataset.population !== undefined;
}

// Metric types that can be combined with a population. Types not listed here
// are rejected.
const POPULATION_METRIC_TYPES = new Set<FactMetricType>(["proportion", "mean"]);

/** Why a metric can't be combined with any Population. */
export type PopulationIneligibilityReason = "metricType" | "percentileCap";

/**
 * Why a metric can't be combined with a given Population, including reasons
 * why it can't be combined with any Population, or because of an incompatible Fact Table.
 */
export type PopulationIncompatibilityReason =
  | PopulationIneligibilityReason
  | "factTable";

/** The parts of a metric's definition that decide whether any Population can use it. */
type PopulationEligibilityFields = Pick<
  FactMetricInterface,
  "metricType" | "cappingSettings" | "lowerCappingSettings"
>;

/**
 * Why a metric can't be combined with any Population, or null if it can. It
 * reads only the metric's definition, so it can run before a Population is
 * chosen. Percentile caps are computed over every unit's rows, not just the
 * Population's members, so they would clip members' values at the wrong cap.
 */
export function getPopulationIneligibility(
  metric: PopulationEligibilityFields,
): PopulationIneligibilityReason | null {
  if (!POPULATION_METRIC_TYPES.has(metric.metricType)) return "metricType";
  const appliesPercentileCap =
    // Proportions never apply caps, but ones saved before capping was
    // validated (#5601) can still carry percentile settings, which mustn't
    // block them.
    isCappableFactMetric(metric.metricType) &&
    getCappingTailState(metric.cappingSettings, metric.lowerCappingSettings)
      .usesPercentile;
  if (appliesPercentileCap) return "percentileCap";
  return null;
}

export function isPopulationEligible(
  metric: PopulationEligibilityFields,
): boolean {
  return getPopulationIneligibility(metric) === null;
}

/**
 * Why a metric can't be combined with the Population that reads from
 * `populationFactTableId`, or null if it can: it must be eligible for any
 * Population and share this one's Fact Table.
 */
export function getPopulationIncompatibility(
  metric: FactMetricInterface,
  populationFactTableId: string,
): PopulationIncompatibilityReason | null {
  const ineligibility = getPopulationIneligibility(metric);
  if (ineligibility !== null) return ineligibility;
  const sharesFactTable =
    getPopulationMetricFactTableId(metric) === populationFactTableId;
  return sharesFactTable ? null : "factTable";
}

/**
 * The Fact Table a metric's events come from, which a Population on the
 * metric must share. Null for funnel and compound metrics, which have no
 * numerator.
 */
export function getPopulationMetricFactTableId(
  metric: FactMetricInterface,
): string | null {
  return metric.numerator?.factTableId ?? null;
}

/**
 * A metric exploration's Population as it appears in the results cache key:
 * the whole step, so a field added to it changes the key. Every step field
 * changes the query; a render-only one would be omitted here, like metric
 * values' are. The key reads the same as the inline definition explorations
 * sent before they referenced saved Populations, so results cached then still
 * match.
 */
export function getPopulationCacheKey(
  savedPopulation: Pick<PopulationInterface, "steps">,
  unit: string,
): object {
  const step = getSinglePopulationStep(savedPopulation);
  // Multi-step Populations can't be saved yet; key on every step so one never
  // collides with a single-step definition.
  if (!step) return { steps: savedPopulation.steps, unit };
  return { ...step, unit };
}

export type ParsedMetricExplorationPopulation =
  | {
      ok: true;
      /** The saved Population's single step, counted by the chosen unit. */
      population: ResolvedExplorationPopulation;
    }
  | {
      ok: false;
      /** Every problem at once, so an editor can show them together. */
      violations: string[];
    };

type SavedPopulationForExploration = Pick<
  PopulationInterface,
  "datasource" | "userIdTypes" | "steps"
>;

/**
 * Checks a metric exploration's saved Population against the request without
 * looking at its metrics, and returns the definition the query runs. Run it
 * before serving cached results: the cache is keyed on the Population's steps,
 * so a Population that stopped fitting the request (another Data Source, or no
 * longer supporting the identifier type) would otherwise still be served.
 */
export function resolveSavedPopulation({
  population,
  savedPopulation,
  datasource,
}: {
  population: ExplorationPopulation;
  /** Callers handle a missing Population, each with its own message. */
  savedPopulation: SavedPopulationForExploration;
  datasource: string;
}): ParsedMetricExplorationPopulation {
  if (savedPopulation.datasource !== datasource) {
    return {
      ok: false,
      violations: [
        "The Population must use the same Data Source as the metrics.",
      ],
    };
  }
  const step = getSinglePopulationStep(savedPopulation);
  if (!step) {
    return {
      ok: false,
      violations: [
        "Only Populations with a single step can be combined with metrics.",
      ],
    };
  }
  if (!savedPopulation.userIdTypes.includes(population.unit)) {
    return {
      ok: false,
      violations: [
        `The Population doesn't support the identifier type "${population.unit}".`,
      ],
    };
  }
  return { ok: true, population: { ...step, unit: population.unit } };
}

/**
 * Validates a metric exploration's Population against its saved definition
 * and the request, and returns the definition the query runs. The Population
 * applies to every metric in the request, so one incompatible metric rejects
 * the request.
 */
export function parseMetricExplorationPopulation({
  population,
  savedPopulation,
  values,
  dimensions,
  datasource,
  metricMap,
  factTableMap,
}: {
  population: ExplorationPopulation;
  /** Callers handle a missing Population, each with its own message. */
  savedPopulation: SavedPopulationForExploration;
  values: MetricDataset["values"];
  dimensions: ProductAnalyticsDimension[];
  datasource: string;
  metricMap: Map<string, FactMetricInterface>;
  factTableMap: Map<string, PopulationRuleFactTable>;
}): ParsedMetricExplorationPopulation {
  const resolvedPopulation = resolveSavedPopulation({
    population,
    savedPopulation,
    datasource,
  });
  if (!resolvedPopulation.ok) return resolvedPopulation;
  const resolved = resolvedPopulation.population;

  const violations: string[] = [];
  if (values.some((value) => value.draftMetric)) {
    violations.push("Metrics with populations require a saved metric.");
  }
  // The chart sums rows that share a series and x, which a second dimension
  // would cause; summed shares of a Population are meaningless.
  if (
    dimensions.length > 1 ||
    dimensions.some((d) => d.dimensionType !== "date")
  ) {
    violations.push(
      "Metrics with populations can only be grouped by one date dimension.",
    );
  }
  for (const value of values) {
    const metric = metricMap.get(value.metricId);
    if (!metric) {
      violations.push(`Metric ${value.metricId} not found.`);
      continue;
    }
    const incompatibility = getPopulationIncompatibility(
      metric,
      resolved.source.factTableId,
    );
    // A metric no Population can use has to be replaced, so its identifier
    // type doesn't matter. A Fact Table mismatch can be fixed by choosing
    // another Population instead, so the metric is still worth checking.
    switch (incompatibility) {
      case "metricType":
        violations.push(
          `Metric "${metric.name}" can't be combined with a Population. Populations currently support only proportion and mean metrics, and the Population applies to every metric in the request.`,
        );
        continue;
      case "percentileCap":
        violations.push(
          `Metric "${metric.name}" can't be combined with a Population because it uses percentile capping, which is computed across all units rather than the Population's members.`,
        );
        continue;
      case "factTable":
        violations.push(
          `Metric "${metric.name}" must use the same Fact Table as the Population.`,
        );
        break;
      case null:
        break;
      default: {
        const unhandled: never = incompatibility;
        throw new Error(`Unhandled Population incompatibility: ${unhandled}`);
      }
    }
    if (value.unit !== population.unit) {
      violations.push(
        `Metric "${metric.name}" must use the population's identifier type "${population.unit}".`,
      );
    }
  }
  if (!values.length) {
    violations.push("Populations require at least one metric.");
  }
  // Check the Population's own rules only once the metrics fit it.
  if (violations.length) return { ok: false, violations };

  const ruleViolations = getPopulationRuleViolations({
    datasource,
    userIdTypes: [resolved.unit],
    steps: [resolved],
    factTables: [...factTableMap.values()],
  });
  if (ruleViolations.length) return { ok: false, violations: ruleViolations };

  return { ok: true, population: resolved };
}
