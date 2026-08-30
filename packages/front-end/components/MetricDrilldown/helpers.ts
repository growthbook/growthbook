import { ExperimentTableRow } from "@/services/experiments";

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
