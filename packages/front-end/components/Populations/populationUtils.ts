import type { PopulationStep } from "shared/validators";
import type { FactTableDefinition } from "shared/types/fact-table";
import { formatFilterPreview } from "@/enterprise/components/ProductAnalytics/util";

function pluralize(n: number, unit: string): string {
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

export type PopulationStepDescriptionParts = {
  beforeFactTableName: string;
  factTableName: string;
  afterFactTableName: string;
};

function getColumnDisplayName(
  columnKey: string,
  factTable: FactTableDefinition | null,
): string {
  return (
    factTable?.columns.find((c) => c.column === columnKey)?.name || columnKey
  );
}

// A one-line summary such as "Has Events matching the row filter: country=US
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
  factTable: FactTableDefinition | null;
}): PopulationStepDescriptionParts {
  const { rowFilters, aggregateFilter, aggregateFilterColumn } = step;

  const filtersDescriptions: string[] = [];

  if (rowFilters?.length) {
    const rowFiltersPrefix =
      rowFilters?.length === 1 ? "row filter: " : "row filters: ";
    const rowFiltersDescription = `${rowFiltersPrefix}${rowFilters
      .map((rf) => formatFilterPreview(rf, factTable))
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
