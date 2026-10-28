import type {
  ExplorationConfig,
  MetricValue,
  MetricPopulation,
} from "shared/validators";
import { getPopulationRuleViolations } from "shared/populations";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";

// A dataset-level population applies to every metric in the request, so each
// metric must be compatible with it; one unsupported metric rejects the request.
export function validatePopulationMetricCompatibility(
  config: Pick<ExplorationConfig, "datasource" | "dimensions">,
  metricValue: MetricValue,
  metric: FactMetricInterface,
  population: MetricPopulation,
  factTable: FactTableInterface,
): void {
  if (
    metric.metricType !== "proportion" ||
    metric.numerator.column !== "$$distinctUsers"
  ) {
    throw new Error(
      `Metric "${metric.name}" can't be combined with a Population. Populations currently support only proportion metrics, and the Population applies to every metric in the request.`,
    );
  }
  if (config.dimensions.some((d) => d.dimensionType !== "date")) {
    throw new Error("Metrics with populations can only be grouped by date.");
  }
  if (
    metric.datasource !== config.datasource ||
    population.source.factTableId !== metric.numerator.factTableId ||
    factTable.id !== metric.numerator.factTableId
  ) {
    throw new Error(
      "The population and metric must use the same Fact Table and Data Source.",
    );
  }
  if (!metricValue.unit || !factTable.userIdTypes.includes(metricValue.unit)) {
    throw new Error(
      "Select an identifier type supported by both the population and metric.",
    );
  }
  const violations = getPopulationRuleViolations({
    datasource: config.datasource,
    userIdTypes: [metricValue.unit],
    steps: [population],
    factTables: [factTable],
  });
  if (violations.length) throw new Error(violations.join(" "));
}
