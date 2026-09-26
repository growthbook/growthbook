import React, {
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  columnWidthBounds,
  fitColumnWidths,
  isLayoutCustomized,
  mergeLayoutForWrite,
  resolveTableColumns,
  ResolvedTableColumn,
  TableColumnDef,
  TableColumnLayout,
} from "@/services/tableColumns";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { SearchReturn } from "@/services/search";
import { TableCell, TableColumnHeader } from "@/ui/Table";
import ColumnResizeHandle from "@/ui/ColumnResizeHandle";
import ColumnSettingsButton from "@/ui/ColumnSettingsButton";

function total(widths: Map<string, number>): number {
  return Array.from(widths.values()).reduce((sum, w) => sum + w, 0);
}

export interface TableColumnLayoutState {
  layout: TableColumnLayout | null;
  setLayout: Dispatch<SetStateAction<TableColumnLayout | null>>;
}

/**
 * A table's persisted column layout. Separate from `useTableColumns` so a page
 * can read it before building its column defs, e.g. with `isColumnVisible`.
 *
 * The storage key mirrors useSearch's `${localStorageKey}:sort-dir` convention,
 * so a page's persisted table state reads as one family.
 */
export function useTableColumnLayout(
  storageKey: string,
): TableColumnLayoutState {
  const [layout, setLayout] = useLocalStorage<TableColumnLayout | null>(
    `${storageKey}:columns`,
    null,
  );
  return { layout, setLayout };
}

export interface UseTableColumnsReturn<TRow> {
  /** All columns in their effective order, hidden ones included. */
  columns: ResolvedTableColumn<TRow>[];
  visibleColumns: ResolvedTableColumn<TRow>[];
  colSpan: number;
  /** Spread onto `<Table>`: the fixed layout the widths rely on, and its floor. */
  tableProps: {
    layout: "fixed";
    minTableWidth: number;
    managedColumns: true;
  };
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
 * Columns fit the table's container; see `fitColumnWidths`.
 */
export function useTableColumns<TRow>({
  layout: { layout, setLayout },
  columns: defs,
  SortableHeader,
}: {
  layout: TableColumnLayoutState;
  columns: TableColumnDef<TRow>[];
  /** useSearch's header, for columns with a `sortField`. */
  SortableHeader?: SearchReturn<TRow>["SortableTableColumnHeader"];
}): UseTableColumnsReturn<TRow> {
  const colRefs = useRef<Map<string, HTMLTableColElement | null>>(new Map());
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [borderX, setBorderX] = useState(0);

  const columns = useMemo(
    () => resolveTableColumns(defs, layout),
    [defs, layout],
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.visible),
    [columns],
  );

  // The last resizable column displays at least as wide as the room left over,
  // so its edge is the row-actions column's. It keeps its own width for
  // fitting, so that spare room is still free for an earlier column to take.
  const fillId = useMemo(
    () => visibleColumns.findLast((col) => col.resizable !== false)?.id,
    [visibleColumns],
  );

  // A layout effect, so a table that needs fitting never paints unfitted first.
  useLayoutEffect(() => {
    // Hidden columns leave null entries behind.
    const table = Array.from(colRefs.current.values())
      .find(Boolean)
      ?.closest("table");
    const wrapper = table?.closest<HTMLElement>("[data-table-list]");
    if (!table || !wrapper) return;
    // Columns share what's inside the table's own border.
    const measure = () => {
      const { borderLeftWidth, borderRightWidth } = getComputedStyle(table);
      const border = parseFloat(borderLeftWidth) + parseFloat(borderRightWidth);
      setBorderX(border);
      setContainerWidth(wrapper.clientWidth - border);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [visibleColumns]);

  const available = containerWidth ?? Infinity;
  const rendered = useMemo(
    () => fitColumnWidths(visibleColumns, available),
    [visibleColumns, available],
  );
  const renderedTotal = total(rendered);
  // Room the fill column shows past its own width.
  const fillExtra = Number.isFinite(available)
    ? Math.max(0, available - renderedTotal)
    : 0;

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

  // Pins `id` at `width`, plus any column left of it that fitting had squeezed,
  // where it is: fitting won't shrink them now, and they mustn't spring back.
  // Rounded, as fitted widths aren't.
  const resizeTo = useCallback(
    (id: string, width: number) => {
      const index = visibleColumns.findIndex((col) => col.id === id);
      const left = new Set(visibleColumns.slice(0, index).map((col) => col.id));
      return (col: ResolvedTableColumn<TRow>): ResolvedTableColumn<TRow> => {
        if (col.id === id) {
          return { ...col, width: Math.round(width), pinned: true };
        }
        const at = rendered.get(col.id);
        return left.has(col.id) &&
          at !== undefined &&
          col.width !== undefined &&
          at < col.width
          ? { ...col, width: Math.round(at), pinned: true }
          : col;
      };
    },
    [visibleColumns, rendered],
  );

  const setWidth = useCallback(
    (id: string, width: number | undefined) => {
      write(
        columns.map(
          width === undefined
            ? (col) =>
                col.id === id
                  ? { ...col, width: undefined, pinned: false }
                  : col
            : resizeTo(id, width),
        ),
      );
    },
    [columns, write, resizeTo],
  );

  // Writing null rather than a defaults blob, so later changes to the code
  // defaults still reach users who have reset.
  const reset = useCallback(() => setLayout(null), [setLayout]);

  // Mid-drag, re-fit around the dragged column as if it were already committed,
  // writing the <col> nodes directly rather than rendering every frame.
  const previewWidth = (id: string, width: number) => {
    const fitted = fitColumnWidths(
      visibleColumns.map(resizeTo(id, width)),
      available,
    );
    fitted.forEach((w, colId) => {
      const el = colRefs.current.get(colId);
      if (el && colId !== fillId) el.style.width = `${w}px`;
    });
    colRefs.current
      .get(id)
      ?.closest<HTMLElement>("[data-table-list]")
      ?.style.setProperty("--table-min-width", `${total(fitted) + borderX}px`);
  };

  const ColGroup = useMemo<React.FC>(() => {
    const Group = () => (
      <colgroup>
        {visibleColumns.map((col) => (
          <col
            key={col.id}
            ref={(el) => {
              colRefs.current.set(col.id, el);
            }}
            // The fill column takes whatever the others leave, down to the
            // table floor, which counts its own width and the table's border.
            style={
              rendered.has(col.id) && col.id !== fillId
                ? { width: rendered.get(col.id) }
                : undefined
            }
          />
        ))}
      </colgroup>
    );
    return Group;
  }, [visibleColumns, rendered, fillId]);

  const renderResizeHandle = (col: ResolvedTableColumn<TRow>) => {
    if (col.resizable === false) return null;
    const { min, max } = columnWidthBounds(col);
    const width = rendered.get(col.id);
    return (
      <ColumnResizeHandle
        label={col.label}
        // The fill column's handle sits at its displayed edge, so it resizes from there.
        width={
          col.id === fillId && width !== undefined ? width + fillExtra : width
        }
        minWidth={min}
        maxWidth={max}
        onCommit={(w) => setWidth(col.id, w)}
        setLiveWidth={(w) => previewWidth(col.id, w)}
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
    <TableCell key={col.id} {...col.cellProps?.(row)}>
      {col.render(row, rendered.get(col.id))}
    </TableCell>
  );

  return {
    columns,
    visibleColumns,
    colSpan: visibleColumns.length,
    tableProps: {
      layout: "fixed",
      minTableWidth: renderedTotal + borderX,
      managedColumns: true,
    },
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
