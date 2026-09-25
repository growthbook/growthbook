import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  columnWidthBounds,
  fitColumnWidths,
  isLayoutCustomized,
  mergeLayoutForWrite,
  minTableWidth,
  resizeColumnWidth,
  resolveTableColumns,
  ResolvedTableColumn,
  TableColumnDef,
  TableColumnLayout,
  withSpacerColumn,
} from "@/services/tableColumns";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { SearchReturn } from "@/services/search";
import { TableCell, TableColumnHeader } from "@/ui/Table";
import ColumnResizeHandle from "@/ui/ColumnResizeHandle";
import ColumnSettingsButton from "@/ui/ColumnSettingsButton";

export interface UseTableColumnsReturn<TRow> {
  /** All columns in their effective order, hidden ones included. */
  columns: ResolvedTableColumn<TRow>[];
  visibleColumns: ResolvedTableColumn<TRow>[];
  colSpan: number;
  /** Spread onto `<Table>`: the fixed layout the widths rely on, and its floor. */
  tableProps: { layout: "fixed"; minTableWidth: number };
  /** Spread onto `<ColumnSettingsButton>`. */
  settingsProps: Omit<
    React.ComponentProps<typeof ColumnSettingsButton>,
    "note" | "trigger"
  >;
  /** Header cell with sort and resize; `children` overrides the column's header. */
  renderHeaderCell: (
    col: ResolvedTableColumn<TRow>,
    children?: ReactNode,
  ) => ReactNode;
  renderCell: (col: ResolvedTableColumn<TRow>, row: TRow) => ReactNode;
  /**
   * Renders the `<colgroup>`. Pass as the first child of `<Table>` — under a
   * fixed layout these widths are what make column sizes authoritative.
   */
  ColGroup: React.FC;
}

/**
 * Column order, visibility and width for a table, persisted per browser.
 *
 * The storage key mirrors useSearch's `${localStorageKey}:sort-dir` convention,
 * so a page's persisted table state reads as one family.
 */
export function useTableColumns<TRow>({
  storageKey,
  columns: codeDefs,
  SortableHeader,
}: {
  storageKey: string;
  columns: TableColumnDef<TRow>[];
  /** useSearch's header, for columns with a `sortField`. */
  SortableHeader?: SearchReturn<TRow>["SortableTableColumnHeader"];
}): UseTableColumnsReturn<TRow> {
  const defs = useMemo(() => withSpacerColumn(codeDefs), [codeDefs]);
  const [layout, setLayout] = useLocalStorage<TableColumnLayout | null>(
    `${storageKey}:columns`,
    null,
  );

  const colRefs = useRef<Map<string, HTMLTableColElement | null>>(new Map());
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  const columns = useMemo(
    () => resolveTableColumns(defs, layout),
    [defs, layout],
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.visible),
    [columns],
  );

  useEffect(() => {
    // Hidden columns leave null entries behind.
    const table = Array.from(colRefs.current.values())
      .find(Boolean)
      ?.closest("table");
    const wrapper = table?.closest<HTMLElement>("[data-table-list]");
    if (!table || !wrapper) return;
    // Columns share what's inside the table's own border.
    const measure = () => {
      const { borderLeftWidth, borderRightWidth } = getComputedStyle(table);
      setContainerWidth(
        wrapper.clientWidth -
          parseFloat(borderLeftWidth) -
          parseFloat(borderRightWidth),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [visibleColumns]);

  // Unmeasured (first paint), nothing is squeezed.
  const available = containerWidth ?? Infinity;
  const rendered = useMemo(
    () => fitColumnWidths(visibleColumns, available),
    [visibleColumns, available],
  );

  const write = useCallback(
    (next: ResolvedTableColumn<TRow>[]) => {
      setLayout((prev) => mergeLayoutForWrite(next, prev));
    },
    [setLayout],
  );

  const applySettings = useCallback(
    (ordered: { id: string; visible: boolean }[]) => {
      const byId = new Map(columns.map((col) => [col.id, col]));
      const next = ordered
        .map(({ id, visible }) => {
          const col = byId.get(id);
          return col ? { ...col, visible } : undefined;
        })
        .filter((col): col is ResolvedTableColumn<TRow> => !!col);
      // Columns the caller didn't mention keep their relative position rather
      // than being dropped.
      columns.forEach((col, i) => {
        if (!ordered.some((o) => o.id === col.id)) next.splice(i, 0, col);
      });
      write(next);
    },
    [columns, write],
  );

  const nextWidths = useCallback(
    (id: string, width: number) =>
      resizeColumnWidth(visibleColumns, rendered, id, width, available),
    [visibleColumns, rendered, available],
  );

  const previewResize = useCallback(
    (id: string, width: number) => {
      nextWidths(id, width).forEach((w, colId) => {
        const el = colRefs.current.get(colId);
        if (el) el.style.width = `${w}px`;
      });
    },
    [nextWidths],
  );

  // Saves every column as rendered, not just the two that moved: re-fitting
  // squeezed saved widths would shift the moved pair away from where they were
  // dropped. So a resize on a narrow page adopts the widths the user sees, and
  // a wider page gives its extra room to the spacer rather than regrowing them.
  const resizeColumn = useCallback(
    (id: string, width: number) => {
      const next = nextWidths(id, width);
      write(
        columns.map((col) =>
          col.visible && col.resizable !== false && next.has(col.id)
            ? { ...col, width: Math.round(next.get(col.id) as number) }
            : col,
        ),
      );
    },
    [columns, nextWidths, write],
  );

  const resetWidth = useCallback(
    (id: string) => {
      write(
        columns.map((col) =>
          col.id === id ? { ...col, width: undefined } : col,
        ),
      );
    },
    [columns, write],
  );

  // Writing null rather than a defaults blob, so later changes to the code
  // defaults still reach users who have reset.
  const reset = useCallback(() => setLayout(null), [setLayout]);

  const ColGroup = useMemo<React.FC>(() => {
    const Group = () => (
      <colgroup>
        {visibleColumns.map((col) => (
          <col
            key={col.id}
            ref={(el) => {
              colRefs.current.set(col.id, el);
            }}
            style={
              rendered.has(col.id) ? { width: rendered.get(col.id) } : undefined
            }
          />
        ))}
      </colgroup>
    );
    return Group;
  }, [visibleColumns, rendered]);

  const renderResizeHandle = (col: ResolvedTableColumn<TRow>) => {
    if (col.resizable === false) return null;
    const { min, max } = columnWidthBounds(col);
    return (
      <ColumnResizeHandle
        label={col.label}
        width={rendered.get(col.id)}
        minWidth={min}
        maxWidth={max}
        onCommit={(w) =>
          w === undefined ? resetWidth(col.id) : resizeColumn(col.id, w)
        }
        setLiveWidth={(w) => previewResize(col.id, w)}
      />
    );
  };

  const renderHeaderCell = (
    col: ResolvedTableColumn<TRow>,
    children: ReactNode = col.header !== undefined ? col.header : col.label,
  ) => {
    const headerProps = {
      className: col.headerProps?.className,
      style: { textAlign: col.align, ...col.headerProps?.style },
    };
    return col.sortField && SortableHeader ? (
      <SortableHeader
        key={col.id}
        field={col.sortField}
        endAdornment={renderResizeHandle(col)}
        {...headerProps}
      >
        {children}
      </SortableHeader>
    ) : (
      <TableColumnHeader key={col.id} {...headerProps}>
        {children}
        {renderResizeHandle(col)}
      </TableColumnHeader>
    );
  };

  const renderCell = (col: ResolvedTableColumn<TRow>, row: TRow) => (
    <TableCell key={col.id} clip={col.clip} {...col.cellProps?.(row)}>
      {col.render(row, rendered.get(col.id))}
    </TableCell>
  );

  return {
    columns,
    visibleColumns,
    colSpan: visibleColumns.length,
    tableProps: { layout: "fixed", minTableWidth: minTableWidth(columns) },
    settingsProps: {
      // Locked columns can't be hidden or moved, so listing them is noise.
      columns: columns
        .filter((col) => !col.locked)
        .map((col) => ({
          id: col.id,
          label: col.label,
          visible: col.visible,
          alwaysVisible: col.hideable === false,
        })),
      hiddenCount: columns.length - visibleColumns.length,
      canReset: isLayoutCustomized(defs, columns),
      onReset: reset,
      onChange: applySettings,
    },
    renderHeaderCell,
    renderCell,
    ColGroup,
  };
}
