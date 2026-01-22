import { useMemo, useState } from "react";
import { StatsEngine } from "shared/types/stats";
import { ExperimentTableRow } from "@/services/experiments";

type SortBy = "significance" | "change" | "metrics" | "metricTags" | null;
type SortDirection = "asc" | "desc" | null;

export interface UseSliceRowsParams {
  rows: ExperimentTableRow[];
  metricId: string;
  // Controlled from parent (modal manages these to share across tabs)
  baselineRow: number;
  variationFilter?: number[];
  searchTerm?: string;
  statsEngine: StatsEngine;
}

export interface UseSliceRowsReturn {
  // Processed rows ready for ResultsTable - with deep-copied variations
  rowsToRender: ExperimentTableRow[];
  // The main (non-slice) metric row
  mainRow: ExperimentTableRow | undefined;
  // All slice rows for this metric (unfiltered)
  sliceRows: ExperimentTableRow[];
  // Filtered slice rows (after search)
  filteredSliceRows: ExperimentTableRow[];
  // Sorting state (managed internally by this hook)
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  sortDirection: SortDirection;
  setSortDirection: (dir: SortDirection) => void;
}

/**
 * Hook to process slice rows for the metric drilldown modal.
 * Takes baseline/variation settings as controlled props and ensures
 * proper row object creation for React to detect changes.
 *
 * Key feature: Creates deep copies of row.variations arrays to ensure
 * ResultsTable's memoization sees new objects when baseline changes.
 */
export function useSliceRows({
  rows,
  metricId,
  baselineRow,
  searchTerm = "",
  statsEngine,
}: UseSliceRowsParams): UseSliceRowsReturn {
  // Sorting state is managed internally (local to slices tab)
  const [sortBy, setSortBy] = useState<SortBy>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  // Get the main (non-slice) row for this metric
  const mainRow = useMemo(() => {
    return rows.find((r) => !r.isSliceRow && r.metric.id === metricId);
  }, [rows, metricId]);

  // Get all slice rows for this metric
  const sliceRows = useMemo(() => {
    return rows.filter((row) => row.isSliceRow && row.metric.id === metricId);
  }, [rows, metricId]);

  // Apply search filter
  const filteredSliceRows = useMemo(() => {
    if (!searchTerm) return sliceRows;

    const term = searchTerm.toLowerCase();
    return sliceRows.filter((row) => {
      const sliceName =
        typeof row.label === "string" ? row.label : row.metric.name;
      return sliceName.toLowerCase().includes(term);
    });
  }, [sliceRows, searchTerm]);

  // Apply sorting
  const sortedSliceRows = useMemo(() => {
    if (!sortBy || !sortDirection) return filteredSliceRows;

    // Find the first non-baseline variation index to use for sorting
    const sortVariationIndex =
      baselineRow === 0 ? 1 : baselineRow === 1 ? 0 : 1;

    return [...filteredSliceRows].sort((a, b) => {
      const aVariation = a.variations[sortVariationIndex];
      const bVariation = b.variations[sortVariationIndex];

      let aValue: number | undefined;
      let bValue: number | undefined;

      if (sortBy === "significance") {
        // For bayesian, use chanceToWin; for frequentist, use pValue
        if (statsEngine === "bayesian") {
          aValue = aVariation?.chanceToWin;
          bValue = bVariation?.chanceToWin;
        } else {
          aValue = aVariation?.pValue;
          bValue = bVariation?.pValue;
        }
      } else if (sortBy === "change") {
        aValue = aVariation?.uplift?.mean;
        bValue = bVariation?.uplift?.mean;
      }

      // Handle undefined values - push them to the end
      if (aValue === undefined && bValue === undefined) return 0;
      if (aValue === undefined) return 1;
      if (bValue === undefined) return -1;

      const comparison = aValue - bValue;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredSliceRows, sortBy, sortDirection, baselineRow, statsEngine]);

  // Create the final rows to render
  // CRITICAL: We create deep copies of row objects with new variations arrays
  // This ensures ResultsTable sees these as new objects when baseline/variation changes
  // Without this, React's memoization may not detect the need to recompute
  const rowsToRender = useMemo(() => {
    const allRows = mainRow ? [mainRow, ...sortedSliceRows] : sortedSliceRows;

    // Create new row objects with deep-copied variations arrays
    // This forces ResultsTable to recompute rowsResults when baseline changes
    return allRows.map((row) => ({
      ...row,
      // Deep copy the variations array AND each variation object
      // This ensures all nested data has new identity
      variations: row.variations.map((v) => ({
        ...v,
        // Also copy nested objects if they exist
        ...(v.uplift && { uplift: { ...v.uplift } }),
        ...(v.ci && { ci: [v.ci[0], v.ci[1]] as [number, number] }),
      })),
    }));
  }, [mainRow, sortedSliceRows]);

  return {
    rowsToRender,
    mainRow,
    sliceRows,
    filteredSliceRows,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
  };
}
