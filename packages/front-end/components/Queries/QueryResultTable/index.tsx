import { ReactNode, useMemo } from "react";
import { cellText, GetCellText } from "./columnWidths";
import {
  RESULT_TABLE_COLUMN_VIRTUALIZATION_THRESHOLD,
  RESULT_TABLE_ROW_VIRTUALIZATION_THRESHOLD,
} from "./constants";
import PlainQueryResultTable from "./PlainQueryResultTable";
import VirtualizedQueryResultTable from "./VirtualizedQueryResultTable";

type RenderValue = (value: unknown) => ReactNode;

export default function QueryResultTable({
  rows,
  renderValue,
  // Used to calculate column widths for column virtualization
  getCellText = cellText,
}: {
  rows: Record<string, unknown>[];
  renderValue: RenderValue;
  getCellText?: GetCellText;
}) {
  const columns = useMemo(() => Object.keys(rows[0] || {}), [rows]);

  const shouldVirtualize =
    rows.length > RESULT_TABLE_ROW_VIRTUALIZATION_THRESHOLD ||
    columns.length > RESULT_TABLE_COLUMN_VIRTUALIZATION_THRESHOLD;

  if (!shouldVirtualize) {
    return (
      <PlainQueryResultTable
        rows={rows}
        columns={columns}
        renderValue={renderValue}
      />
    );
  }

  return (
    <VirtualizedQueryResultTable
      rows={rows}
      columns={columns}
      renderValue={renderValue}
      getCellText={getCellText}
    />
  );
}
