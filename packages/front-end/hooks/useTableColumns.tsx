import React, { useCallback, useMemo, useRef } from "react";
import {
  isLayoutCustomized,
  mergeLayoutForWrite,
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
  /** Apply order and visibility in a single write. */
  applySettings: (ordered: { id: string; visible: boolean }[]) => void;
  setWidth: (id: string, width: number | undefined) => void;
  reset: () => void;
  /** Live `<col>` nodes, keyed by column id, for imperative width writes. */
  colRefs: React.MutableRefObject<Map<string, HTMLTableColElement | null>>;
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

  const columns = useMemo(
    () => resolveTableColumns(defs, layout),
    [defs, layout],
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.visible),
    [columns],
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

  const setWidth = useCallback(
    (id: string, width: number | undefined) => {
      write(columns.map((col) => (col.id === id ? { ...col, width } : col)));
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
            style={col.width ? { width: col.width } : undefined}
          />
        ))}
      </colgroup>
    );
    return Group;
  }, [visibleColumns]);

  return {
    columns,
    visibleColumns,
    colSpan: visibleColumns.length,
    hiddenCount: columns.length - visibleColumns.length,
    isCustomized: isLayoutCustomized(defs, columns),
    applySettings,
    setWidth,
    reset,
    colRefs,
    ColGroup,
  };
}
