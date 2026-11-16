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
import { isProjectListValidForProject } from "shared/util";
import type {
  FactMetricInterface,
  FactMetricType,
  StandardFactMetricInterface,
} from "shared/types/fact-table";

/** Whether a config's metric dataset has a population. */
export function configHasPopulation(config: ExplorationConfig | null): boolean {
  if (config?.dataset.type !== "metric") return false;
  return config.dataset.population !== undefined;
}

/**
 * Whether a saved Population can be offered for a metric chart: it's in the
 * current Project, on the chart's Data Source, reads from the metrics' shared
 * Fact Table, and supports the chart's identifier type (any, when none is
 * chosen yet).
 */
export function populationFitsMetricChart(
  candidate: Pick<
    PopulationInterface,
    "projects" | "datasource" | "userIdTypes" | "steps"
  >,
  chart: {
    project: string;
    datasource: string;
    /** The metrics' shared Fact Table; null when they don't share one. */
    factTableId: string | null;
    unit: string | null;
  },
): boolean {
  return (
    isProjectListValidForProject(candidate.projects, chart.project) &&
    candidate.datasource === chart.datasource &&
    getSinglePopulationStep(candidate)?.source.factTableId ===
      chart.factTableId &&
    (!chart.unit || candidate.userIdTypes.includes(chart.unit))
  );
}

/**
 * Why a metric chart's Population can't be used, for the editor. Values
 * without a metric chosen yet are skipped.
 */
export function getMetricChartPopulationViolations({
  population,
  savedPopulation,
  values,
  dimensions,
  datasource,
  getFactMetricById,
  factTables,
}: {
  population: ExplorationPopulation;
  /** Null when the saved Population was deleted or can't be read. */
  savedPopulation: Pick<
    PopulationInterface,
    "datasource" | "userIdTypes" | "steps"
  > | null;
  values: MetricDataset["values"];
  dimensions: ProductAnalyticsDimension[];
  datasource: string;
  getFactMetricById: (id: string) => FactMetricInterface | null;
  factTables: PopulationRuleFactTable[];
}): string[] {
  if (!savedPopulation) {
    return [
      "This Population was deleted or you don't have access to it. Choose another Population or None.",
    ];
  }
  const chosenValues = values.filter((value) => value.metricId);
  const metricMap = new Map<string, FactMetricInterface>();
  for (const value of chosenValues) {
    const metric = getFactMetricById(value.metricId);
    if (metric) metricMap.set(metric.id, metric);
  }
  const parsed = parseMetricExplorationPopulation({
    population,
    savedPopulation,
    values: chosenValues,
    dimensions,
    datasource,
    metricMap,
    factTableMap: new Map(factTables.map((table) => [table.id, table])),
  });
  return parsed.ok ? [] : parsed.violations;
}

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
