import { useMemo } from "react";
import { ExperimentSortBy } from "shared/experiments";
import { ExperimentTableRow, compareRows } from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

interface UseTableSortingParams {
  rows: ExperimentTableRow[];
  sortBy: ExperimentSortBy;
  sortDirection: "asc" | "desc" | null;
  variationFilter?: number[];
}

/**
 * Hook to sort experiment table rows using the compareRows logic.
 * Reusable by both main results table and metric drilldown modal.
 */
export function useTableSorting({
  rows,
  sortBy,
  sortDirection,
  variationFilter = [],
}: UseTableSortingParams): ExperimentTableRow[] {
  const { metricDefaults } = useOrganizationMetricDefaults();

  return useMemo(() => {
    // If no sorting, return as-is
    if (!sortBy || !sortDirection || !metricDefaults) {
      return rows;
    }

    // Only sort for significance or change
    if (sortBy !== "significance" && sortBy !== "change") {
      return rows;
    }

    const sortOptions = {
      sortBy,
      variationFilter,
      metricDefaults,
      sortDirection,
    };

    // Sort parent rows and maintain parent-child relationships
    const parentRows = rows.filter((row) => !row.parentRowId);
    const sortedParents = [...parentRows].sort((a, b) =>
      compareRows(a, b, sortOptions),
    );

    const result: ExperimentTableRow[] = [];
    sortedParents.forEach((parent) => {
      result.push(parent);
      const childRows = rows.filter(
        (row) => row.parentRowId === parent.metric?.id,
      );
      const sortedChildren = [...childRows].sort((a, b) =>
        compareRows(a, b, sortOptions),
      );
      result.push(...sortedChildren);
    });

    return result;
  }, [rows, sortBy, sortDirection, variationFilter, metricDefaults]);
}
