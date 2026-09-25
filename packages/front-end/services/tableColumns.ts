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
  /** Sized by the user, so fitting the table to its container leaves it alone. */
  pinned: boolean;
};

type ColumnVisibilityDef = Pick<
  TableColumnDef<unknown>,
  "id" | "locked" | "hideable" | "defaultHidden"
>;

function isHideable(def: ColumnVisibilityDef): boolean {
  return !def.locked && def.hideable !== false;
}

function visibleFor(
  def: ColumnVisibilityDef,
  entry: TableColumnLayoutEntry | undefined,
): boolean {
  return isHideable(def) ? (entry?.visible ?? !def.defaultHidden) : true;
}

function isValidLayout(
  stored: TableColumnLayout | null | undefined,
): stored is TableColumnLayout {
  return (
    !!stored &&
    stored.v === TABLE_COLUMN_LAYOUT_VERSION &&
    Array.isArray(stored.columns)
  );
}

/**
 * Whether one column shows under a stored layout, without resolving the rest.
 * For work that must be decided before the column defs exist, such as skipping
 * a fetch only a hidden column needs.
 */
export function isColumnVisible(
  stored: TableColumnLayout | null | undefined,
  def: ColumnVisibilityDef,
): boolean {
  const entry = isValidLayout(stored)
    ? stored.columns.find((e) => e && e.id === def.id)
    : undefined;
  return visibleFor(def, entry);
}

/**
 * Adds the column that absorbs leftover width, ahead of any trailing locked
 * columns (e.g. row actions).
 */
export function withSpacerColumn<TRow>(
  defs: TableColumnDef<TRow>[],
): TableColumnDef<TRow>[] {
  let insertAt = defs.length;
  while (insertAt > 0 && defs[insertAt - 1].locked) insertAt--;
  return [
    ...defs.slice(0, insertAt),
    {
      id: "spacer",
      label: "",
      header: null,
      locked: true,
      resizable: false,
      minWidth: 0,
      render: () => null,
    },
    ...defs.slice(insertAt),
  ];
}

/** The effective resize bounds for a column, applying the shared defaults. */
export function columnWidthBounds<TRow>(def: TableColumnDef<TRow>): {
  min: number;
  max: number;
} {
  // An explicit 0 is honoured: a spacer column has no content to protect.
  const min =
    def.minWidth === 0
      ? 0
      : Math.max(
          def.minWidth ?? MIN_TABLE_COLUMN_WIDTH,
          HARD_MIN_TABLE_COLUMN_WIDTH,
        );
  return { min, max: Math.max(min, def.maxWidth ?? MAX_TABLE_COLUMN_WIDTH) };
}

function isShrinkable<TRow>(col: ResolvedTableColumn<TRow>): boolean {
  return col.width !== undefined && col.resizable !== false && !col.pinned;
}

/**
 * Narrowest the table can get: fitting has shrunk every column it may to its
 * minimum. Past this the table overflows its container and the page scrolls.
 *
 * Also floors a slack column: under `table-layout: fixed` a column with no width
 * takes only what the others leave over, so it would otherwise starve to zero.
 */
export function minTableWidth<TRow>(
  resolved: ResolvedTableColumn<TRow>[],
): number {
  return resolved
    .filter((col) => col.visible)
    .reduce(
      (sum, col) =>
        sum +
        (isShrinkable(col)
          ? columnWidthBounds(col).min
          : (col.width ?? columnWidthBounds(col).min)),
      0,
    );
}

/**
 * The widths visible columns render at in a container `available` px wide,
 * keyed by id. Columns with no width (the slack column) are left out: they take
 * whatever is left over.
 *
 * Widths apply as-is while they fit. Past that, columns the user hasn't sized
 * shrink in proportion to their width, each stopping at its minimum; pinned
 * columns keep their width, and the table overflows once nothing else can give.
 */
export function fitColumnWidths<TRow>(
  visible: ResolvedTableColumn<TRow>[],
  available: number,
): Map<string, number> {
  const sized = visible.filter((col) => col.width !== undefined);
  const widths = new Map(sized.map((col) => [col.id, col.width as number]));
  const slackMin = visible
    .filter((col) => col.width === undefined)
    .reduce((sum, col) => sum + columnWidthBounds(col).min, 0);
  let excess =
    Array.from(widths.values()).reduce((sum, w) => sum + w, 0) +
    slackMin -
    available;
  let shrinkable = sized.filter(
    (col) =>
      isShrinkable(col) &&
      (widths.get(col.id) as number) > columnWidthBounds(col).min,
  );
  // Each pass hands the remaining excess to the columns still above their
  // minimum; one hitting its floor passes its share on to the next pass.
  while (excess > 0.5 && shrinkable.length) {
    const total = shrinkable.reduce(
      (sum, col) => sum + (widths.get(col.id) as number),
      0,
    );
    let taken = 0;
    shrinkable = shrinkable.filter((col) => {
      const width = widths.get(col.id) as number;
      const { min } = columnWidthBounds(col);
      const next = Math.max(min, width - (excess * width) / total);
      widths.set(col.id, next);
      taken += width - next;
      return next > min;
    });
    excess -= taken;
  }
  return widths;
}

function clampWidth<TRow>(
  def: TableColumnDef<TRow>,
  width: number | undefined,
): number | undefined {
  if (width === undefined || !Number.isFinite(width) || width <= 0) {
    return undefined;
  }
  const { min, max } = columnWidthBounds(def);
  return Math.min(Math.max(width, min), max);
}

function defaultsFor<TRow>(
  defs: TableColumnDef<TRow>[],
): ResolvedTableColumn<TRow>[] {
  return defs.map((def) => ({
    ...def,
    visible: visibleFor(def, undefined),
    width: clampWidth(def, def.defaultWidth),
    pinned: false,
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
  if (!isValidLayout(stored)) return defaultsFor(defs);

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
    const defaultWidth = clampWidth(def, def.defaultWidth);
    // A column the user can't resize has no stored width worth honouring —
    // it is a stale copy of a past default, and it would shadow the current
    // one forever for anyone who has already saved a layout.
    const width =
      clampWidth(def, def.resizable === false ? undefined : entry?.width) ??
      defaultWidth;
    return {
      ...def,
      visible: visibleFor(def, entry),
      width,
      pinned: width !== defaultWidth,
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
      ...resolved.map((col) => ({
        id: col.id,
        visible: col.visible,
        // Only a width the user chose, so later changes to the default still reach them.
        width:
          col.width === clampWidth(col, col.defaultWidth)
            ? undefined
            : col.width,
      })),
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
