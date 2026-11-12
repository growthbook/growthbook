import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import { columnOnlyRowFilterOperators } from "./validators/fact-table";
import { getSelectedColumnDatatype } from "./experiments/experiments";
import { parseAggregateFilter } from "./aggregate-filters";

// Multi-step populations aren't supported yet.
export const MAX_POPULATION_STEPS = 1;
/** Distinct fact tables a population's steps may read from. */
export const MAX_POPULATION_FACT_TABLES = 5;

export type PopulationRuleFactTable = Pick<
  FactTableInterface,
  "id" | "datasource" | "userIdTypes" | "columns" | "filters"
>;

// Unlike fact metrics, a filter with no comparisons (such as ",") is invalid:
// it would silently drop the step's threshold.
function isValidAggregateFilter(aggregateFilter: string): boolean {
  const { conditions, invalid } = parseAggregateFilter(aggregateFilter);
  return conditions.length > 0 && !invalid.length;
}

// Names the steps a violation is about. With a single step the label adds
// nothing, and the editor never mentions steps.
function stepLabel(stepNumbers: number[], stepCount: number): string {
  return stepCount > 1 ? ` (step ${stepNumbers.join(", ")})` : "";
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
  const factTableMap: FactTableMap = new Map(factTables.map((f) => [f.id, f]));
  return [
    ...getFactTableViolations(steps, factTableMap, datasource, userIdTypes),
    ...getRowFilterViolations(steps, factTableMap),
    ...getAggregateFilterViolations(steps, factTableMap),
  ];
}

type FactTableMap = Map<string, PopulationRuleFactTable>;

function getFactTableViolations(
  steps: PopulationStep[],
  factTableMap: FactTableMap,
  datasource: string,
  userIdTypes: string[],
): string[] {
  const violations: string[] = [];

  const factTableIds = getPopulationFactTableIds(steps);
  if (factTableIds.length > MAX_POPULATION_FACT_TABLES) {
    violations.push(
      `Populations can read from at most ${MAX_POPULATION_FACT_TABLES} distinct fact tables (this one reads from ${factTableIds.length}).`,
    );
  }

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

  return violations;
}

// Each of these would be dropped from the SQL, silently widening the
// population.
function getRowFilterViolations(
  steps: PopulationStep[],
  factTableMap: FactTableMap,
): string[] {
  const violations: string[] = [];

  steps.forEach((step, i) => {
    const label = stepLabel([i + 1], steps.length);
    const stepFactTable = factTableMap.get(step.source.factTableId);

    step.rowFilters.forEach((filter, j) => {
      if (filter.operator === "sql_expr") {
        if (!filter.values?.[0]?.trim()) {
          violations.push(`Row filter ${j + 1} has no SQL expression${label}.`);
        }
      } else if (filter.operator !== "saved_filter") {
        if (!filter.column) {
          violations.push(`Row filter ${j + 1} needs a column${label}.`);
        } else if (
          !(columnOnlyRowFilterOperators as readonly string[]).includes(
            filter.operator,
          ) &&
          !hasUsableValue(filter, stepFactTable)
        ) {
          violations.push(`Row filter ${j + 1} needs a value${label}.`);
        }
      }
    });

    const missingFilters = stepFactTable
      ? step.rowFilters
          .filter((f) => f.operator === "saved_filter")
          .map((f) => f.values?.[0] ?? "")
          .filter((id) => !stepFactTable.filters.some((f) => f.id === id))
      : [];
    if (missingFilters.length) {
      violations.push(
        `Saved filter not found on Fact Table ${step.source.factTableId}: ${missingFilters.join(", ")}${label}.`,
      );
    }
  });

  return violations;
}

// The query builder ignores a filter with no values, and on a date column it
// also ignores blank ones.
function hasUsableValue(
  filter: PopulationStep["rowFilters"][number],
  factTable: PopulationRuleFactTable | undefined,
): boolean {
  const values = filter.values ?? [];
  const isDate =
    !!factTable &&
    getSelectedColumnDatatype({ factTable, column: filter.column ?? "" }) ===
      "date";
  return isDate ? values.some((v) => v.trim() !== "") : values.length > 0;
}

function getAggregateFilterViolations(
  steps: PopulationStep[],
  factTableMap: FactTableMap,
): string[] {
  const violations: string[] = [];

  const halfAggregateSteps = steps
    .map((step, i) =>
      !!step.aggregateFilter !== !!step.aggregateFilterColumn ? i + 1 : null,
    )
    .filter((n): n is number => n !== null);
  if (halfAggregateSteps.length) {
    violations.push(
      `Must specify both "aggregateFilter" and "aggregateFilterColumn" or neither${stepLabel(halfAggregateSteps, steps.length)}.`,
    );
  }

  steps.forEach((step, i) => {
    const { aggregateFilter, aggregateFilterColumn } = step;
    if (!aggregateFilter || !aggregateFilterColumn) return;
    const label = stepLabel([i + 1], steps.length);

    if (!isValidAggregateFilter(aggregateFilter)) {
      violations.push(
        `Invalid aggregate filter "${aggregateFilter}"${label}. Use comparisons such as ">=3" or ">=3,<10".`,
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
        `Aggregate filter column '${aggregateFilterColumn}' must be a numeric column or "$$count"${label}.`,
      );
    }
  });

  return violations;
}
