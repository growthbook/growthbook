import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import { getSelectedColumnDatatype } from "./experiments/experiments";
import {
  AggregateFilterCondition,
  PARTIAL_AGGREGATE_CONDITION_REGEX,
  parseAggregateFilter,
} from "./aggregate-filters";

export const MAX_POPULATION_STEPS = 20;
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
  factTables: PopulationRuleFactTable[];
  // Slim fact tables (such as the front-end's definitions) omit jsonFields, so
  // a JSON sub-field's type can't be checked. The server always checks it.
  jsonFieldTypesUnknown?: boolean;
};

export function getPopulationFactTableIds(steps: PopulationStep[]): string[] {
  return [...new Set(steps.map((step) => step.source.factTableId))];
}

// Falls back to the fact table id when the name is unknown, e.g. the fact
// table was deleted or isn't visible in the current project.
export function getPopulationStepsLabel(
  steps: PopulationStep[],
  getFactTableName: (factTableId: string) => string | undefined,
): string {
  return steps
    .map((step) => {
      const name =
        getFactTableName(step.source.factTableId) || step.source.factTableId;
      return step.negation ? `no ${name}` : name;
    })
    .join(" → ");
}

// The step a conversion window is measured from. Negated steps have no date,
// so they are skipped. Returns null for the first step.
export function getPopulationStepAnchorIndex(
  steps: Pick<PopulationStep, "negation">[],
  stepIndex: number,
): number | null {
  for (let i = stepIndex - 1; i >= 0; i--) {
    if (!steps[i].negation) return i;
  }
  return null;
}

export const POPULATION_AGGREGATE_OPERATORS = [
  { operator: ">=", label: "at least" },
  { operator: ">", label: "more than" },
  { operator: "=", label: "exactly" },
  { operator: "<=", label: "at most" },
  { operator: "<", label: "less than" },
  { operator: "!=", label: "not equal to" },
] as const;

function pluralize(n: number, unit: string): string {
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

// A one-line summary such as "Doesn't have an Orders row within 7 days after
// step 1". Row filters are counted rather than spelled out.
export function describePopulationStep({
  steps,
  index,
  factTableName,
  aggregateColumnName,
  unit,
}: {
  steps: PopulationStep[];
  index: number;
  factTableName: string;
  aggregateColumnName?: string;
  unit: string;
}): string {
  const step = steps[index];
  const article = /^[aeiou]/i.test(factTableName) ? "an" : "a";
  const parts = [
    `${step.negation ? "Doesn't have" : "Has"} ${article} ${factTableName} row`,
  ];

  if (step.rowFilters.length) {
    parts.push(`matching ${pluralize(step.rowFilters.length, "filters")}`);
  }

  const { aggregateFilter, aggregateFilterColumn } = step;
  if (aggregateFilter && aggregateFilterColumn) {
    const subject =
      aggregateFilterColumn === "$$count"
        ? "rows"
        : `total ${aggregateColumnName || aggregateFilterColumn}`;
    const single = parseSingleAggregateFilter(aggregateFilter);
    const label = single
      ? POPULATION_AGGREGATE_OPERATORS.find(
          (o) => o.operator === single.operator,
        )?.label
      : undefined;
    parts.push(
      single && label
        ? aggregateFilterColumn === "$$count"
          ? `with ${label} ${single.value} rows per ${unit}`
          : `with ${subject} ${label} ${single.value} per ${unit}`
        : `with ${subject} ${aggregateFilter} per ${unit}`,
    );
  }

  const { type, windowValue, windowUnit } = step.windowSettings;
  if (type === "lookback") {
    parts.push(`in the last ${pluralize(windowValue, windowUnit)}`);
  } else if (type === "conversion") {
    const anchor = getPopulationStepAnchorIndex(steps, index);
    if (anchor !== null) {
      parts.push(
        `within ${pluralize(windowValue, windowUnit)} after step ${anchor + 1}`,
      );
    }
  }

  return parts.join(" ");
}

// Returns null when the filter can't be shown as one operator and value, such
// as a range like ">=3,<10". "<>" is normalized to "!=".
export function parseSingleAggregateFilter(
  aggregateFilter: string,
): AggregateFilterCondition | null {
  const { conditions, invalid } = parseAggregateFilter(aggregateFilter);
  if (conditions.length !== 1 || invalid.length) return null;
  const [{ operator, value }] = conditions;
  return { operator: normalizeOperator(operator), value };
}

// Splits an aggregate filter into the editor's operator dropdown and number
// box. Unlike parseSingleAggregateFilter, the value may be empty or a partial
// number while the user types. An empty filter starts at "at least". Returns
// null when the filter can only be edited as raw text, such as ">=3,<10".
export function parseAggregateFilterForEditor(
  aggregateFilter: string,
): AggregateFilterCondition | null {
  const compact = aggregateFilter.replace(/\s*/g, "");
  if (!compact) return { operator: ">=", value: "" };
  const match = compact.match(PARTIAL_AGGREGATE_CONDITION_REGEX);
  if (!match) return null;
  return { operator: normalizeOperator(match[1]), value: match[2] };
}

// POPULATION_AGGREGATE_OPERATORS offers "!=" but not its "<>" synonym.
function normalizeOperator(operator: string): string {
  return operator === "<>" ? "!=" : operator;
}

// Returns every violation so an editor can show them all at once.
export function getPopulationRuleViolations({
  datasource,
  userIdTypes,
  steps,
  factTables,
  jsonFieldTypesUnknown = false,
}: PopulationRuleInput): string[] {
  const violations: string[] = [];

  if (steps[0]?.windowSettings.type === "conversion") {
    violations.push("The first step cannot use a conversion window.");
  }
  if (steps[0]?.negation) {
    violations.push(`The first step cannot be a "doesn't have" step.`);
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
    if (jsonFieldTypesUnknown) {
      const baseColumn = factTable.columns.find(
        (c) => c.column === aggregateFilterColumn.split(".")[0],
      );
      if (
        aggregateFilterColumn.includes(".") &&
        baseColumn?.datatype === "json" &&
        !baseColumn.jsonFields
      ) {
        return;
      }
    }
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
