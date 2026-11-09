import type {
  ExplorationPopulation,
  MetricDataset,
  PopulationInterface,
  ProductAnalyticsDimension,
  ResolvedExplorationPopulation,
} from "shared/validators";
import {
  getPopulationRuleViolations,
  type PopulationRuleFactTable,
} from "shared/populations";
import type {
  FactMetricInterface,
  FactMetricType,
  StandardFactMetricInterface,
} from "shared/types/fact-table";

// Metric types that can be combined with a population. Types not listed here
// are rejected.
const POPULATION_METRIC_TYPES = new Set<FactMetricType>(["proportion"]);

function isSupportedWithPopulation(
  metric: FactMetricInterface,
): metric is StandardFactMetricInterface {
  return POPULATION_METRIC_TYPES.has(metric.metricType);
}

/** The parts of a saved Population an exploration reads. */
export type ExplorationSavedPopulation = Pick<
  PopulationInterface,
  "id" | "datasource" | "userIdTypes" | "steps"
>;

/**
 * The definition an exploration runs for its Population: the saved
 * Population's single step, counted by the exploration's identifier type.
 */
export function resolveExplorationPopulation(
  population: ExplorationPopulation,
  savedPopulation: ExplorationSavedPopulation,
): ResolvedExplorationPopulation {
  return { ...savedPopulation.steps[0], unit: population.unit };
}

// The population applies to every metric in the request, so one incompatible
// metric rejects the request.
export function getMetricPopulationViolations({
  population,
  savedPopulation,
  values,
  dimensions,
  datasource,
  metricMap,
  factTableMap,
}: {
  population: ExplorationPopulation;
  /** Null when no saved Population with `population.populationId` can be read. */
  savedPopulation: ExplorationSavedPopulation | null;
  values: MetricDataset["values"];
  dimensions: ProductAnalyticsDimension[];
  datasource: string;
  metricMap: Map<string, FactMetricInterface>;
  factTableMap: Map<string, PopulationRuleFactTable>;
}): string[] {
  if (!savedPopulation) {
    return [`Population ${population.populationId} not found.`];
  }
  if (savedPopulation.datasource !== datasource) {
    return ["The Population must use the same Data Source as the metrics."];
  }
  if (savedPopulation.steps.length !== 1) {
    return [
      "Only Populations with a single step can be combined with metrics.",
    ];
  }
  if (!savedPopulation.userIdTypes.includes(population.unit)) {
    return [
      `The Population doesn't support the identifier type "${population.unit}".`,
    ];
  }
  const resolved = resolveExplorationPopulation(population, savedPopulation);

  const violations: string[] = [];
  if (values.some((value) => value.draftMetric)) {
    violations.push("Metrics with populations require a saved metric.");
  }
  if (dimensions.some((d) => d.dimensionType !== "date")) {
    violations.push("Metrics with populations can only be grouped by date.");
  }
  for (const value of values) {
    const metric = metricMap.get(value.metricId);
    if (!metric) {
      violations.push(`Metric ${value.metricId} not found.`);
      continue;
    }
    if (!isSupportedWithPopulation(metric)) {
      const supported = [...POPULATION_METRIC_TYPES].join(", ");
      violations.push(
        `Metric "${metric.name}" can't be combined with a Population. Populations currently support only ${supported} metrics, and the Population applies to every metric in the request.`,
      );
      continue;
    }
    if (metric.numerator.factTableId !== resolved.source.factTableId) {
      violations.push(
        `Metric "${metric.name}" must use the same Fact Table as the Population.`,
      );
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

  // return early if there are metric incompatibility violations
  if (violations.length) return violations;

  return getPopulationRuleViolations({
    datasource,
    userIdTypes: [resolved.unit],
    steps: [resolved],
    factTables: [...factTableMap.values()],
  });
}
