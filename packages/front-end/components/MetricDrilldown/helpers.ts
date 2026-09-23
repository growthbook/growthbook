import { funnelStepMetricId } from "shared/experiments";
import { ExperimentReportResultDimension } from "shared/types/report";
import {
  ExperimentTableRow,
  NO_DATA_ERROR_MESSAGE,
} from "@/services/experiments";

export function filterRowsForMetricDrilldown(
  rows: ExperimentTableRow[],
  metricId: string,
  searchTerm?: string,
): {
  mainRow: ExperimentTableRow | undefined;
  sliceRows: ExperimentTableRow[];
  filteredSliceRows: ExperimentTableRow[];
} {
  const mainRow = rows.find((r) => !r.isSliceRow && r.metric.id === metricId);

  const sliceRows = rows.filter(
    (row) => row.isSliceRow && row.metric.id === metricId,
  );

  let filteredSliceRows = sliceRows;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredSliceRows = sliceRows.filter((row) => {
      const sliceName =
        typeof row.label === "string" ? row.label : row.metric.name;
      return sliceName.toLowerCase().includes(term);
    });
  }

  return { mainRow, sliceRows, filteredSliceRows };
}

/**
 * Re-points whole-funnel slice rows at a single step, led by that step's own
 * row. Step slice ids are minted the same way the stats engine mints them
 * (`{metricId}?{slice}&step={k}`), so results and time series both resolve.
 */
export function buildFunnelStepSliceRows({
  stepRow,
  sliceRows,
  stepIndex,
  results,
}: {
  stepRow: ExperimentTableRow | undefined;
  sliceRows: ExperimentTableRow[];
  stepIndex: number;
  results: ExperimentReportResultDimension;
}): ExperimentTableRow[] {
  const stepSliceRows: ExperimentTableRow[] = sliceRows.map((row) => {
    const stepSliceId = row.sliceId
      ? funnelStepMetricId(row.sliceId, stepIndex)
      : undefined;
    return {
      ...row,
      sliceId: stepSliceId,
      childRowType: "funnelSlice",
      funnelStepIndex: stepIndex,
      variations: results.variations.map(
        (v) =>
          (stepSliceId ? v.metrics?.[stepSliceId] : undefined) || {
            users: 0,
            value: 0,
            cr: 0,
            errorMessage: NO_DATA_ERROR_MESSAGE,
          },
      ),
    };
  });

  if (!stepRow) return stepSliceRows;

  // The step heads its own slices here, so it can no longer be a child row —
  // sorting groups children under a parent that has no parent of its own.
  return [
    {
      ...stepRow,
      parentRowId: undefined,
      isChildRow: false,
      numChildren: stepSliceRows.length,
    },
    ...stepSliceRows,
  ];
}
