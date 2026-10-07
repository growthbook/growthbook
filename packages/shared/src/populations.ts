import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import { getSelectedColumnDatatype } from "./experiments/experiments";

export const MAX_POPULATION_STEPS = 20;
/** Distinct fact tables a population's steps may read from. */
export const MAX_POPULATION_FACT_TABLES = 5;

export type PopulationRuleFactTable = Pick<
  FactTableInterface,
  "id" | "datasource" | "userIdTypes" | "columns"
>;

export type PopulationAggregateCondition = { operator: string; value: string };

// Same grammar as fact metric aggregate filters: comma-separated comparisons.
const AGGREGATE_CONDITION_REGEX = /^(=|!=|<>|<=|<|>=|>)(\d+(\.\d+)?)$/;

function splitAggregateFilter(aggregateFilter: string): string[] {
  return aggregateFilter.replace(/\s*/g, "").split(",").filter(Boolean);
}

export function parsePopulationAggregateFilter(
  aggregateFilter: string,
): PopulationAggregateCondition[] {
  return splitAggregateFilter(aggregateFilter).map((part) => {
    const match = part.match(AGGREGATE_CONDITION_REGEX);
    if (!match) throw new Error(`Invalid aggregate filter: ${part}`);
    return { operator: match[1], value: match[2] };
  });
}

function isValidAggregateFilter(aggregateFilter: string): boolean {
  const parts = splitAggregateFilter(aggregateFilter);
  return (
    parts.length > 0 &&
    parts.every((part) => AGGREGATE_CONDITION_REGEX.test(part))
  );
}

export type PopulationRuleInput = {
  datasource: string;
  userIdTypes: string[];
  steps: PopulationStep[];
  factTables: PopulationRuleFactTable[];
};

export function getPopulationFactTableIds(steps: PopulationStep[]): string[] {
  return [...new Set(steps.map((step) => step.source.factTableId))];
}

// Returns every violation so an editor can show them all at once.
export function getPopulationRuleViolations({
  datasource,
  userIdTypes,
  steps,
  factTables,
}: PopulationRuleInput): string[] {
  const violations: string[] = [];

  if (steps.length > MAX_POPULATION_STEPS) {
    violations.push(
      `Populations can have at most ${MAX_POPULATION_STEPS} steps (this one has ${steps.length}).`,
    );
  }

  if (steps[0]?.windowSettings.type === "conversion") {
    violations.push("The first step cannot use a conversion window.");
  }

  const halfAggregateSteps = steps
    .map((step, i) =>
      !!step.aggregateFilter !== !!step.aggregateFilterColumn ? i + 1 : null,
    )
    .filter((n): n is number => n !== null);
  if (halfAggregateSteps.length) {
    violations.push(
      `Must specify both "aggregateFilter" and "aggregateFilterColumn" or neither (step ${halfAggregateSteps.join(", ")}).`,
    );
  }

  const factTableIds = getPopulationFactTableIds(steps);
  if (factTableIds.length > MAX_POPULATION_FACT_TABLES) {
    violations.push(
      `Populations can read from at most ${MAX_POPULATION_FACT_TABLES} distinct fact tables (this one reads from ${factTableIds.length}).`,
    );
  }

  const factTableMap = new Map(factTables.map((f) => [f.id, f]));
  for (const factTableId of factTableIds) {
    const factTable = factTableMap.get(factTableId);
    if (!factTable) {
      violations.push(`Fact table ${factTableId} not found.`);
      continue;
    }
    if (factTable.datasource !== datasource) {
      violations.push(
        `Fact table ${factTableId} is not in Data Source ${datasource}.`,
      );
      continue;
    }
    const missing = userIdTypes.filter(
      (t) => !factTable.userIdTypes.includes(t),
    );
    if (missing.length) {
      violations.push(
        `Fact table ${factTableId} does not support identifier types: ${missing.join(", ")}.`,
      );
    }
  }

  steps.forEach((step, i) => {
    const { aggregateFilter, aggregateFilterColumn } = step;
    if (!aggregateFilter || !aggregateFilterColumn) return;

    if (!isValidAggregateFilter(aggregateFilter)) {
      violations.push(
        `Invalid aggregate filter "${aggregateFilter}" (step ${i + 1}). Use comparisons such as ">=3" or ">=3,<10".`,
      );
    }

    const factTable = factTableMap.get(step.source.factTableId);
    if (!factTable || aggregateFilterColumn === "$$count") return;
    const columnType = getSelectedColumnDatatype({
      factTable,
      column: aggregateFilterColumn,
    });
    if (columnType !== "number") {
      violations.push(
        `Aggregate filter column '${aggregateFilterColumn}' must be a numeric column or "$$count" (step ${i + 1}).`,
      );
    }
  });

  return violations;
}
