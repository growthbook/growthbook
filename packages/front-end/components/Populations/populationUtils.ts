import type { PopulationStep } from "shared/validators";
import type { FactTableDefinition } from "shared/types/fact-table";
import { getRowFilterDescription } from "@/components/FactTables/rowFilterUtils";

function pluralize(n: number, unit: string): string {
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

export type PopulationStepDescriptionSegment =
  | string
  | { label: string; href: string };

function getColumnDisplayName(
  columnKey: string,
  factTable: FactTableDefinition | null,
): string {
  return (
    factTable?.columns.find((c) => c.column === columnKey)?.name || columnKey
  );
}

// A one-line summary such as "Has Events matching the row filter: country = US
// in the last 1 week", as text and link segments so callers can render both text and links.
// TODO: Describe conversion windows once Populations support multiple steps.
export function describePopulationStep({
  step,
  identifierTypes,
  factTable,
}: {
  step: PopulationStep;
  identifierTypes: string[];
  factTable: FactTableDefinition | null;
}): PopulationStepDescriptionSegment[] {
  const { rowFilters, aggregateFilter, aggregateFilterColumn } = step;

  const filtersDescriptions: string[] = [];

  if (rowFilters?.length) {
    const rowFiltersPrefix =
      rowFilters?.length === 1 ? "row filter: " : "row filters: ";
    const rowFiltersDescription = `${rowFiltersPrefix}${rowFilters
      .map((rf) => getRowFilterDescription(rf, factTable))
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

  let conditionsDescriptions = filtersDescriptions.length
    ? ` matching the ${filtersDescriptions.join(" and ")}`
    : "";

  const { type, windowValue, windowUnit } = step.windowSettings;
  if (type === "lookback") {
    conditionsDescriptions += ` in the last ${pluralize(windowValue, windowUnit)}`;
  }

  const { factTableId } = step.source;
  const factTableSegment: PopulationStepDescriptionSegment = factTable
    ? {
        label: factTable.name || factTableId,
        href: `/fact-tables/${factTableId}`,
      }
    : factTableId;

  return ["Has ", factTableSegment, conditionsDescriptions].filter(
    (segment) => segment !== "",
  );
}
