import type { PopulationStep } from "shared/validators";
import type { FactTableDefinition } from "shared/types/fact-table";
import { getRowFilterDescription } from "@/components/FactTables/rowFilterUtils";

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

// Returns text and link segments, e.g. "Has Events matching country = US".
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
    filtersDescriptions.push(
      rowFilters.map((rf) => getRowFilterDescription(rf, factTable)).join(", "),
    );
  }

  if (aggregateFilter && aggregateFilterColumn) {
    const isCount = aggregateFilterColumn === "$$count";
    const aggregateFilterDescription = isCount
      ? `count ${aggregateFilter} per ${identifierTypes.join(", ")}`
      : `total ${getColumnDisplayName(aggregateFilterColumn, factTable)} ${aggregateFilter} per ${identifierTypes.join(", ")}`;
    filtersDescriptions.push(aggregateFilterDescription);
  }

  const conditionsDescriptions = filtersDescriptions.length
    ? ` matching ${filtersDescriptions.join(" and ")}`
    : "";

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
