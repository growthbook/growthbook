import { useMemo } from "react";
import { ExperimentSortBy } from "shared/experiments";
import { MetricDefaults } from "shared/types/organization";
import { ExperimentTableRow, compareRows } from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

interface UseTableSortingParams {
  rows: ExperimentTableRow[];
  sortBy: ExperimentSortBy;
  sortDirection: "asc" | "desc" | null;
  variationFilter?: number[];
}

/**
 * Sort experiment table rows by the compareRows logic while keeping each
 * parent's children grouped beneath it. Funnel steps always keep their funnel
 * order (first step to last); slice children sort within their group. Pure so
 * it can be unit-tested without the hook.
 */
export function sortExperimentTableRows({
  rows,
  sortBy,
  sortDirection,
  variationFilter = [],
  metricDefaults,
}: {
  rows: ExperimentTableRow[];
  sortBy: ExperimentSortBy;
  sortDirection: "asc" | "desc" | null;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
}): ExperimentTableRow[] {
  // Only significance and change are sortable; anything else is a no-op.
  if (
    !sortBy ||
    !sortDirection ||
    (sortBy !== "significance" && sortBy !== "change")
  ) {
    return rows;
  }

  const sortOptions = {
    sortBy,
    variationFilter,
    metricDefaults,
    sortDirection,
  };

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
    // Funnel steps always render in funnel order regardless of the active
    // column sort; slice children still sort within their group.
    const isFunnelSteps = childRows.some(
      (row) => row.childRowType === "funnelStep",
    );
    const sortedChildren = isFunnelSteps
      ? [...childRows].sort(
          (a, b) => (a.funnelStepIndex ?? 0) - (b.funnelStepIndex ?? 0),
        )
      : [...childRows].sort((a, b) => compareRows(a, b, sortOptions));
    result.push(...sortedChildren);
  });

  return result;
}

/**
 * Hook wrapper around sortExperimentTableRows.
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
    if (!metricDefaults) {
      return rows;
    }
    return sortExperimentTableRows({
      rows,
      sortBy,
      sortDirection,
      variationFilter,
      metricDefaults,
    });
  }, [rows, sortBy, sortDirection, variationFilter, metricDefaults]);
}
