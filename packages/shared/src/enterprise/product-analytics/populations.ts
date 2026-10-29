import type {
  ExplorationPopulation,
  MetricDataset,
  ProductAnalyticsDimension,
} from "shared/validators";
import { getPopulationRuleViolations } from "shared/populations";
import type {
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
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

// Rules that depend only on the request, so they can be checked before any
// metrics or Fact Tables are loaded.
export function getPopulationDatasetViolations(
  dataset: MetricDataset,
  dimensions: ProductAnalyticsDimension[],
): string[] {
  if (!dataset.population) return [];
  const violations: string[] = [];
  if (dataset.values.some((value) => value.draftMetric)) {
    violations.push("Metrics with populations require a saved metric.");
  }
  if (dimensions.some((d) => d.dimensionType !== "date")) {
    violations.push("Metrics with populations can only be grouped by date.");
  }
  return violations;
}

// The population applies to every metric in the request, so one incompatible
// metric rejects the request.
export function getPopulationMetricViolations({
  population,
  datasource,
  values,
  metricMap,
  factTableMap,
}: {
  population: ExplorationPopulation;
  datasource: string;
  values: MetricDataset["values"];
  metricMap: Map<string, FactMetricInterface>;
  factTableMap: Map<string, FactTableInterface>;
}): string[] {
  const violations: string[] = [];
  for (const value of values) {
    const metric = metricMap.get(value.metricId);
    if (!metric) continue;
    if (!isSupportedWithPopulation(metric)) {
      const supported = [...POPULATION_METRIC_TYPES].join(", ");
      violations.push(
        `Metric "${metric.name}" can't be combined with a Population. Populations currently support only ${supported} metrics, and the Population applies to every metric in the request.`,
      );
      continue;
    }
    if (metric.numerator.factTableId !== population.source.factTableId) {
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
  return [
    ...violations,
    ...getPopulationRuleViolations({
      datasource,
      userIdTypes: [population.unit],
      steps: [population],
      factTables: [...factTableMap.values()],
    }),
  ];
}
