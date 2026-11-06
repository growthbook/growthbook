import type {
  ApiPopulation,
  ExplorationConfig,
  PopulationExplorationConfig,
  PopulationStep,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { FactTableDefinition } from "shared/types/fact-table";
import { getRowFilterDescription } from "@/components/FactTables/rowFilterUtils";
import { getDailyBuckets } from "@/components/QueryPreview/activityChart";

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

// The preview query for a Population
export function getPopulationPreviewConfig(
  population: Pick<ApiPopulation, "datasource" | "steps">,
  unit: string,
  dateRange: ExplorationConfig["dateRange"],
): PopulationExplorationConfig {
  return {
    type: "population",
    datasource: population.datasource,
    chartType: "bar",
    showAs: "total",
    dateRange,
    dimensions: [
      { dimensionType: "date", column: "date", dateGranularity: "day" },
    ],
    dataset: {
      type: "population",
      values: population.steps.map((step) => ({
        type: "population",
        name: "Members",
        unit,
        source: step.source,
        rowFilters: step.rowFilters,
        aggregateFilter: step.aggregateFilter,
        aggregateFilterColumn: step.aggregateFilterColumn,
      })),
    },
  };
}

export function getPopulationMemberCounts(
  exploration: Pick<
    ProductAnalyticsExploration,
    "dateStart" | "dateEnd" | "result"
  >,
) {
  const byDay = new Map(
    (exploration.result?.rows ?? []).map((row) => [
      row.dimensions[0]?.slice(0, 10),
      row.values?.[0]?.numerator ?? 0,
    ]),
  );
  const dailyValues = getDailyBuckets(exploration).map((day) => ({
    day,
    value: byDay.get(day) ?? 0,
  }));
  return {
    dailyValues,
    total: dailyValues.reduce((sum, { value }) => sum + value, 0),
  };
}
