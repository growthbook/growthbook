import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import { getSelectedColumnDatatype } from "./experiments/experiments";
import {
  AggregateFilterCondition,
  PARTIAL_AGGREGATE_CONDITION_REGEX,
  parseAggregateFilter,
} from "./aggregate-filters";

// Multi-step populations aren't supported yet.
export const MAX_POPULATION_STEPS = 1;
/** Distinct fact tables a population's steps may read from. */
export const MAX_POPULATION_FACT_TABLES = 5;

export type PopulationRuleFactTable = Pick<
  FactTableInterface,
  "id" | "datasource" | "userIdTypes" | "columns"
>;

// Unlike fact metrics, a filter with no comparisons (such as ",") is invalid:
// it would silently drop the step's threshold.
export function isValidPopulationAggregateFilter(
  aggregateFilter: string,
): boolean {
  const { conditions, invalid } = parseAggregateFilter(aggregateFilter);
  return conditions.length > 0 && !invalid.length;
}

export type PopulationRuleInput = {
  datasource: string;
  userIdTypes: string[];
  steps: PopulationStep[];
  // Needs each column's jsonFields to type JSON sub-fields, which the slim
  // definitions payload strips.
  factTables: PopulationRuleFactTable[];
};

export function getPopulationFactTableIds(steps: PopulationStep[]): string[] {
  return [...new Set(steps.map((step) => step.source.factTableId))];
}

// Splits an aggregate filter into an editor's operator dropdown and number box.
// The value may be empty or a partial number while the user types. An empty
// filter starts at "at least". Returns null when the filter can only be edited
// as raw text, such as ">=3,<10". "<>" is normalized to "!=".
export function parseAggregateFilterForEditor(
  aggregateFilter: string,
): AggregateFilterCondition | null {
  const compact = aggregateFilter.replace(/\s*/g, "");
  if (!compact) return { operator: ">=", value: "" };
  const match = compact.match(PARTIAL_AGGREGATE_CONDITION_REGEX);
  if (!match) return null;
  return { operator: match[1] === "<>" ? "!=" : match[1], value: match[2] };
}

// Returns every violation so an editor can show them all at once.
export function getPopulationRuleViolations({
  datasource,
  userIdTypes,
  steps,
  factTables,
}: PopulationRuleInput): string[] {
  const violations: string[] = [];

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

    if (!isValidPopulationAggregateFilter(aggregateFilter)) {
      violations.push(
        `Invalid aggregate filter "${aggregateFilter}" (step ${i + 1}). Use comparisons such as ">=3" or ">=3,<10".`,
      );
    }

    const factTable = factTableMap.get(step.source.factTableId);
    if (!factTable || aggregateFilterColumn === "$$count") return;
    const columnType = getSelectedColumnDatatype({
      factTable,
      column: aggregateFilterColumn,
      excludeDeleted: true,
    });
    if (columnType !== "number") {
      violations.push(
        `Aggregate filter column '${aggregateFilterColumn}' must be a numeric column or "$$count" (step ${i + 1}).`,
      );
    }
  });

  return violations;
}
