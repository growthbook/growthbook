import { CSSProperties, ReactNode, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import styles from "./QueryResultTable.module.scss";
import { computeColumnWidths, GetCellText } from "./columnWidths";
import {
  CELL_BORDER,
  CELL_FONT_SIZE,
  CELL_LINE_HEIGHT,
  CELL_PADDING,
  RESULT_TABLE_MAX_HEIGHT,
  RESULT_TABLE_ROW_HEIGHT,
  RESULT_TABLE_ROW_OVERSCAN,
  RESULT_TABLE_COLUMN_OVERSCAN,
} from "./constants";

const CELL_STYLE_VARS = {
  "--qrt-cell-font-size": `${CELL_FONT_SIZE}px`,
  "--qrt-cell-line-height": `${CELL_LINE_HEIGHT}`,
  "--qrt-cell-padding": `${CELL_PADDING}px`,
  "--qrt-cell-border": `${CELL_BORDER}px`,
};

export default function VirtualizedQueryResultTable({
  rows,
  columns,
  renderValue,
  getCellText,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  renderValue: (value: unknown) => ReactNode;
  getCellText: GetCellText;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const columnWidths = useMemo(
    () => computeColumnWidths(rows, columns, getCellText),
    [rows, columns, getCellText],
  );
  const columnCount = columnWidths.length;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESULT_TABLE_ROW_HEIGHT,
    overscan: RESULT_TABLE_ROW_OVERSCAN,
    // The sticky header occupies the first row-height of the scroll content, so
    // the body list starts that far down. Setting scrollMargin to the header
    // height keeps the visible-window math correct and makes each item's `start`
    // already include the offset — so it doubles as the absolute top below.
    scrollMargin: RESULT_TABLE_ROW_HEIGHT,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => columnWidths[index],
    overscan: RESULT_TABLE_COLUMN_OVERSCAN,
  });

  const totalWidth = columnVirtualizer.getTotalSize();
  const bodyHeight = rowVirtualizer.getTotalSize();
  const columnItems = columnVirtualizer.getVirtualItems();
  const innerHeight = RESULT_TABLE_ROW_HEIGHT + bodyHeight;

  const scrollAreaStyle: CSSProperties = {
    ...CELL_STYLE_VARS,
    maxWidth: `min(100%, ${totalWidth}px)`,
    maxHeight: RESULT_TABLE_MAX_HEIGHT,
    overflow: "auto",
  };

  return (
    <div ref={scrollRef} style={scrollAreaStyle}>
      <div
        style={{
          position: "relative",
          width: totalWidth,
          height: innerHeight,
        }}
      >
        <div
          className={styles.headerRow}
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            width: totalWidth,
            height: RESULT_TABLE_ROW_HEIGHT,
          }}
        >
          {columnItems.map((column) => {
            // Column 0 is the index column header, intentionally blank.
            const label = column.index === 0 ? "" : columns[column.index - 1];
            return (
              <div
                key={column.index}
                title={label || undefined}
                className={clsx(
                  styles.cell,
                  styles.headerCell,
                  column.index === 0 && styles.firstColumn,
                )}
                style={{
                  position: "absolute",
                  left: column.start,
                  width: column.size,
                  height: RESULT_TABLE_ROW_HEIGHT,
                }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Body cells are positioned absolutely below the header. row.start
            already includes the header offset because scrollMargin equals the
            header height, so it doubles as the absolute top within this box. */}
        {rowVirtualizer.getVirtualItems().map((row) =>
          columnItems.map((column) => {
            const cellStyle: CSSProperties = {
              position: "absolute",
              top: row.start,
              left: column.start,
              width: column.size,
              height: row.size,
            };

            if (column.index === 0) {
              return (
                <div
                  key={`${row.index}:${column.index}`}
                  className={clsx(
                    styles.cell,
                    styles.indexCell,
                    styles.firstColumn,
                  )}
                  style={cellStyle}
                >
                  {row.index}
                </div>
              );
            }

            const value = rows[row.index][columns[column.index - 1]];
            return (
              <div
                key={`${row.index}:${column.index}`}
                title={getCellText(value)}
                className={styles.cell}
                style={cellStyle}
              >
                {renderValue(value)}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
