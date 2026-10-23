import type {
  ExplorationConfig,
  MetricValue,
  PopulationInterface,
} from "shared/validators";
import { getPopulationRuleViolations } from "shared/populations";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";

export type ExplorationPopulation = Pick<
  PopulationInterface,
  "id" | "datasource" | "userIdTypes" | "steps"
>;

export function validateMetricPopulation(
  config: Pick<ExplorationConfig, "datasource" | "dimensions">,
  value: MetricValue,
  metric: FactMetricInterface,
  population: ExplorationPopulation,
  factTable: FactTableInterface,
): void {
  if (
    metric.metricType !== "proportion" ||
    metric.numerator.column !== "$$distinctUsers"
  ) {
    throw new Error("Populations currently support only proportion metrics.");
  }
  if (config.dimensions.some((d) => d.dimensionType !== "date")) {
    throw new Error("Metrics with populations can only be grouped by date.");
  }
  if (
    population.steps.length !== 1 ||
    population.steps[0].windowSettings.type
  ) {
    throw new Error("Select a single-step population without a time window.");
  }
  if (
    population.datasource !== config.datasource ||
    metric.datasource !== config.datasource ||
    population.steps[0].source.factTableId !== metric.numerator.factTableId ||
    factTable.id !== metric.numerator.factTableId
  ) {
    throw new Error(
      "The population and metric must use the same Fact Table and Data Source.",
    );
  }
  if (!value.unit || !population.userIdTypes.includes(value.unit)) {
    throw new Error(
      "Select an identifier type supported by both the population and metric.",
    );
  }
  const violations = getPopulationRuleViolations({
    datasource: config.datasource,
    userIdTypes: [value.unit],
    steps: population.steps,
    factTables: [factTable],
  });
  if (violations.length) throw new Error(violations.join(" "));
}
