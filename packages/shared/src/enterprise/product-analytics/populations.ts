import type {
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
  /** Null when no saved Population with `population.populationId` can be read. */
  savedPopulation: Pick<
    PopulationInterface,
    "datasource" | "userIdTypes" | "steps"
  > | null;
  values: MetricDataset["values"];
  dimensions: ProductAnalyticsDimension[];
  datasource: string;
  metricMap: Map<string, FactMetricInterface>;
  factTableMap: Map<string, PopulationRuleFactTable>;
}): ParsedMetricExplorationPopulation {
  if (!savedPopulation) {
    return {
      ok: false,
      violations: [`Population ${population.populationId} not found.`],
    };
  }
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
  const resolved: ResolvedExplorationPopulation = {
    ...step,
    unit: population.unit,
  };

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
