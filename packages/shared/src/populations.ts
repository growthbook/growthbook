import type { PopulationStep } from "shared/validators";
import type { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { getSelectedColumnDatatype } from "./experiments/experiments";
import { parseAggregateFilter } from "./aggregate-filters";

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
function isValidAggregateFilter(aggregateFilter: string): boolean {
  const { conditions, invalid } = parseAggregateFilter(aggregateFilter);
  return conditions.length > 0 && !invalid.length;
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

function pluralize(n: number, unit: string): string {
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

export type PopulationStepFactTable = Pick<
  FactTableInterface,
  "name" | "columns" | "filters"
>;

export type PopulationStepDescriptionParts = {
  beforeFactTableName: string;
  factTableName: string;
  afterFactTableName: string;
};

function getColumnDisplayName(
  columnKey: string,
  factTable: PopulationStepFactTable | null,
): string {
  return (
    factTable?.columns.find((c) => c.column === columnKey)?.name || columnKey
  );
}

function describeRowFilter(
  { column, operator, values = [] }: RowFilter,
  factTable: PopulationStepFactTable | null,
): string {
  if (operator === "saved_filter") {
    const filterId = values[0] ?? "";
    // Without the fact table there's no way to tell a deleted filter from one
    // that still exists, so show the id like the fact table name does.
    if (!factTable) return filterId;
    return (
      factTable.filters.find((f) => f.id === filterId)?.name ??
      "Deleted saved filter"
    );
  }
  return [
    column && getColumnDisplayName(column, factTable),
    operator,
    values.join(", "),
  ]
    .filter(Boolean)
    .join(" ");
}

// A one-line summary such as "Has Events matching the row filter: country = US
// in the last 1 week", split around the fact table name so callers can link it
// without searching the text
// TODO: Describe conversion windows once Populations support multiple steps.
export function describePopulationStep({
  step,
  identifierTypes,
  factTable,
}: {
  step: PopulationStep;
  identifierTypes: string[];
  factTable: PopulationStepFactTable | null;
}): PopulationStepDescriptionParts {
  const { rowFilters, aggregateFilter, aggregateFilterColumn } = step;

  const filtersDescriptions: string[] = [];

  if (rowFilters?.length) {
    const rowFiltersPrefix =
      rowFilters?.length === 1 ? "row filter: " : "row filters: ";
    const rowFiltersDescription = `${rowFiltersPrefix}${rowFilters
      .map((rf) => describeRowFilter(rf, factTable))
      .join(", ")}`;
    filtersDescriptions.push(rowFiltersDescription);
  }

  if (aggregateFilter && aggregateFilterColumn) {
    const isCount = aggregateFilterColumn === "$$count";
    const aggregateFilterDescription = isCount
      ? `count ${aggregateFilter} per ${identifierTypes.join(", ")}`
      : `total ${getColumnDisplayName(aggregateFilterColumn, factTable)} ${aggregateFilter} per ${identifierTypes.join(", ")}`;
    filtersDescriptions.push(`aggregate filter: ${aggregateFilterDescription}`);
  }

  let after = filtersDescriptions.length
    ? ` matching the ${filtersDescriptions.join(" and ")}`
    : "";

  const { type, windowValue, windowUnit } = step.windowSettings;
  if (type === "lookback") {
    after += ` in the last ${pluralize(windowValue, windowUnit)}`;
  }

  return {
    beforeFactTableName: "Has ",
    factTableName: factTable?.name || step.source.factTableId,
    afterFactTableName: after,
  };
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
