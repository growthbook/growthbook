import type { CSSProperties, ReactNode } from "react";

const MIN_TABLE_COLUMN_WIDTH = 64;
const MAX_TABLE_COLUMN_WIDTH = 800;
// Floor applied even when a column declares a smaller minWidth.
const HARD_MIN_TABLE_COLUMN_WIDTH = 40;

const TABLE_COLUMN_LAYOUT_VERSION = 1;

export interface TableColumnDef<TRow> {
  /** Stable persisted identity. Never reuse an id for a different column. */
  id: string;
  /** Plain text — used in the settings list and aria labels. */
  label: string;
  /** Rich header content (e.g. label plus an info tooltip). Defaults to `label`. */
  header?: ReactNode;
  /** When set, the header renders as a sortable header for this field. */
  sortField?: keyof TRow & string;
  /**
   * px. Under a fixed table layout, exactly one visible column should omit this
   * and absorb the remaining horizontal slack.
   */
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Cannot be hidden and cannot be moved — pinned to its position in code. */
  locked?: boolean;
  hideable?: boolean;
  resizable?: boolean;
  /** Starts hidden until the user opts in. */
  defaultHidden?: boolean;
  align?: "left" | "center" | "right";
  headerProps?: { className?: string; style?: CSSProperties };
  cellProps?: (row: TRow) => { className?: string; style?: CSSProperties };
  /** `width` is the column's resolved width, for content that must size to it. */
  render: (row: TRow, width: number | undefined) => ReactNode;
}

export interface TableColumnLayoutEntry {
  id: string;
  visible: boolean;
  width?: number;
}

/** Versioned so a future server-side store can accept the blob verbatim. */
export interface TableColumnLayout {
  v: number;
  columns: TableColumnLayoutEntry[];
}

export type ResolvedTableColumn<TRow> = TableColumnDef<TRow> & {
  visible: boolean;
  width?: number;
};

function isHideable<TRow>(def: TableColumnDef<TRow>): boolean {
  return !def.locked && def.hideable !== false;
}

function clampWidth<TRow>(
  def: TableColumnDef<TRow>,
  width: number | undefined,
): number | undefined {
  if (width === undefined || !Number.isFinite(width) || width <= 0) {
    return undefined;
  }
  const min = Math.max(
    def.minWidth ?? MIN_TABLE_COLUMN_WIDTH,
    HARD_MIN_TABLE_COLUMN_WIDTH,
  );
  const max = def.maxWidth ?? MAX_TABLE_COLUMN_WIDTH;
  return Math.min(Math.max(width, min), Math.max(min, max));
}

function defaultsFor<TRow>(
  defs: TableColumnDef<TRow>[],
): ResolvedTableColumn<TRow>[] {
  return defs.map((def) => ({
    ...def,
    visible: isHideable(def) ? !def.defaultHidden : true,
    width: clampWidth(def, def.defaultWidth),
  }));
}

/**
 * Resolve the effective ordered column list from a stored layout.
 *
 * Stored ids are applied in their saved order. Ids that no longer exist in code
 * are dropped. Columns missing from the layout are spliced in next to their
 * neighbour in code rather than appended, so a newly added column doesn't land
 * after the row-actions column. Locked columns are forced visible and forced to
 * their position in code, so a stale layout can never strand them.
 */
export function resolveTableColumns<TRow>(
  defs: TableColumnDef<TRow>[],
  stored: TableColumnLayout | null | undefined,
): ResolvedTableColumn<TRow>[] {
  // The stored value is untrusted: it comes from localStorage, so it can be
  // hand-edited or left behind by a different shape of this schema.
  if (
    !stored ||
    stored.v !== TABLE_COLUMN_LAYOUT_VERSION ||
    !Array.isArray(stored.columns)
  ) {
    return defaultsFor(defs);
  }

  const byId = new Map(defs.map((def) => [def.id, def]));
  const entryById = new Map<string, TableColumnLayoutEntry>();
  const order: string[] = [];
  stored.columns.forEach((entry) => {
    if (!entry || typeof entry.id !== "string") return;
    if (!byId.has(entry.id) || entryById.has(entry.id)) return;
    entryById.set(entry.id, entry);
    order.push(entry.id);
  });

  if (!order.length) return defaultsFor(defs);

  // Splice each unsaved column in after its nearest preceding saved neighbour.
  defs.forEach((def, index) => {
    if (entryById.has(def.id)) return;
    let insertAt = 0;
    for (let i = index - 1; i >= 0; i--) {
      const position = order.indexOf(defs[i].id);
      if (position >= 0) {
        insertAt = position + 1;
        break;
      }
    }
    order.splice(insertAt, 0, def.id);
  });

  const resolved: ResolvedTableColumn<TRow>[] = order.map((id) => {
    const def = byId.get(id) as TableColumnDef<TRow>;
    const entry = entryById.get(id);
    const visible = isHideable(def)
      ? (entry?.visible ?? !def.defaultHidden)
      : true;
    return {
      ...def,
      visible,
      width: clampWidth(def, entry?.width ?? def.defaultWidth),
    };
  });

  // Locked columns ignore the stored order and sit where code puts them.
  const locked = defs
    .map((def, index) => ({ def, index }))
    .filter(({ def }) => def.locked);
  if (locked.length) {
    const unlocked = resolved.filter((col) => !col.locked);
    const byIdResolved = new Map(resolved.map((col) => [col.id, col]));
    locked.forEach(({ def, index }) => {
      const col = byIdResolved.get(def.id);
      if (col) unlocked.splice(index, 0, col);
    });
    return unlocked;
  }

  return resolved;
}

/**
 * Build the blob to persist. Entries for columns that no longer exist in code
 * are carried through, so a rollback or a stale tab doesn't destroy a layout.
 */
export function mergeLayoutForWrite<TRow>(
  resolved: ResolvedTableColumn<TRow>[],
  stored: TableColumnLayout | null | undefined,
): TableColumnLayout {
  const knownIds = new Set(resolved.map((col) => col.id));
  const orphans = (
    stored?.v === TABLE_COLUMN_LAYOUT_VERSION && Array.isArray(stored.columns)
      ? stored.columns
      : []
  ).filter(
    (entry) => entry && typeof entry.id === "string" && !knownIds.has(entry.id),
  );
  return {
    v: TABLE_COLUMN_LAYOUT_VERSION,
    columns: [
      ...resolved.map(({ id, visible, width }) => ({ id, visible, width })),
      ...orphans,
    ],
  };
}

/** True when the resolved layout differs from what the code defaults would give. */
export function isLayoutCustomized<TRow>(
  defs: TableColumnDef<TRow>[],
  resolved: ResolvedTableColumn<TRow>[],
): boolean {
  const defaults = defaultsFor(defs);
  if (defaults.length !== resolved.length) return true;
  return defaults.some((def, i) => {
    const col = resolved[i];
    return (
      def.id !== col.id ||
      def.visible !== col.visible ||
      def.width !== col.width
    );
  });
}
