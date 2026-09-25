import { Fragment, ReactNode, useEffect, useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import RecordDetail from "./RecordDetail";
import { flattenRecord, RecordsColumn } from "./types";

export interface ExpandableTableProps<T extends object> {
  rows: T[];
  columns: RecordsColumn<T>[];
  /** Must be stable across refetches for the same logical row. */
  getRowId: (row: T, index: number) => string;
  /** Defaults to RecordDetail over the whole flattened record. */
  renderDetail?: (row: T) => ReactNode;
  /** Nested objects lifted to the top level in the detail view. */
  detailFlattenKeys?: string[];
  detailTitle?: string;
}

export default function ExpandableTable<T extends object>({
  rows,
  columns,
  getRowId,
  renderDetail,
  detailFlattenKeys,
  detailTitle,
}: ExpandableTableProps<T>) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // A row id from the previous page can collide with a different record on the
  // next one, so collapse whenever the underlying rows change.
  useEffect(() => setExpandedRowId(null), [rows]);

  // +1 for the caret column.
  const totalColumns = columns.length + 1;

  return (
    <Table variant="list" size="md">
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: 32 }} />
          {columns.map((col) => (
            <TableColumnHeader key={col.key} style={{ width: col.width }}>
              {col.header}
            </TableColumnHeader>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => {
          const id = getRowId(row, i);
          const isExpanded = expandedRowId === id;
          const toggle = () => setExpandedRowId(isExpanded ? null : id);

          return (
            <Fragment key={id}>
              <TableRow
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                style={{ cursor: "pointer" }}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <TableCell>
                  {isExpanded ? <PiCaretDown /> : <PiCaretRight />}
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col.key}>{col.render(row)}</TableCell>
                ))}
              </TableRow>
              {isExpanded && (
                <TableRow>
                  <TableCell colSpan={totalColumns}>
                    {renderDetail ? (
                      renderDetail(row)
                    ) : (
                      <RecordDetail
                        fields={flattenRecord(row, {
                          flattenKeys: detailFlattenKeys,
                        })}
                        title={detailTitle}
                      />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
