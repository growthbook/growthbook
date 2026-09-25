import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fitColumnWidths,
  isLayoutCustomized,
  mergeLayoutForWrite,
  minTableWidth,
  resizeColumnWidth,
  resolveTableColumns,
  ResolvedTableColumn,
  TableColumnDef,
  TableColumnLayout,
} from "@/services/tableColumns";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export interface UseTableColumnsReturn<TRow> {
  /** All columns in their effective order, hidden ones included. */
  columns: ResolvedTableColumn<TRow>[];
  visibleColumns: ResolvedTableColumn<TRow>[];
  colSpan: number;
  hiddenCount: number;
  isCustomized: boolean;
  /**
   * Pass to `<Table minTableWidth>`: every column at its minimum. Past this the
   * table overflows and the page scrolls horizontally.
   */
  minTableWidth: number;
  /** The width a column renders at once fitted to the table's container. */
  renderedWidth: (id: string) => number | undefined;
  /** Apply order and visibility in a single write. */
  applySettings: (ordered: { id: string; visible: boolean }[]) => void;
  /** Resize within the container, taking room from spare space or the neighbour. */
  resizeColumn: (id: string, width: number) => void;
  /** Written imperatively during a drag; no React render per frame. */
  previewResize: (id: string, width: number) => void;
  /** Clears the saved width, so the code default applies. */
  resetWidth: (id: string) => void;
  reset: () => void;
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
  columns: defs,
}: {
  storageKey: string;
  columns: TableColumnDef<TRow>[];
}): UseTableColumnsReturn<TRow> {
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

  // Saves every column as rendered, not just the two that moved, or squeezed
  // saved widths would squeeze the moved pair again on the next render.
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

  return {
    columns,
    visibleColumns,
    colSpan: visibleColumns.length,
    hiddenCount: columns.length - visibleColumns.length,
    isCustomized: isLayoutCustomized(defs, columns),
    minTableWidth: minTableWidth(columns),
    renderedWidth: (id) => rendered.get(id),
    applySettings,
    resizeColumn,
    previewResize,
    resetWidth,
    reset,
    ColGroup,
  };
}
