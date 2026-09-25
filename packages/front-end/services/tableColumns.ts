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
  /** Clip content to the cell on one line, with an ellipsis. */
  clip?: boolean;
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

/**
 * Adds the column that absorbs leftover width, ahead of any trailing locked
 * columns (e.g. row actions). Resizing takes from it before a neighbour.
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

function isHideable<TRow>(def: TableColumnDef<TRow>): boolean {
  return !def.locked && def.hideable !== false;
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

/**
 * Narrowest the table can get: every resizable column at its minimum. Past this
 * the table overflows its container and the page scrolls horizontally.
 */
export function minTableWidth<TRow>(
  resolved: ResolvedTableColumn<TRow>[],
): number {
  return resolved
    .filter((col) => col.visible)
    .reduce(
      (sum, col) =>
        sum +
        (col.resizable === false && col.width !== undefined
          ? col.width
          : columnWidthBounds(col).min),
      0,
    );
}

function slackMinWidth<TRow>(visible: ResolvedTableColumn<TRow>[]): number {
  return visible
    .filter((col) => col.width === undefined)
    .reduce((sum, col) => sum + columnWidthBounds(col).min, 0);
}

function sumWidths(widths: Map<string, number>): number {
  return Array.from(widths.values()).reduce((sum, w) => sum + w, 0);
}

/**
 * The widths visible columns render at in a container `available` px wide,
 * keyed by id. Columns with no width (the slack column) are left out: they take
 * whatever is left over.
 *
 * Saved widths apply as-is while they fit. Past that, resizable columns shrink
 * in proportion to their width, each stopping at its minimum, so the table
 * stays inside its container until every column is at its minimum.
 */
export function fitColumnWidths<TRow>(
  visible: ResolvedTableColumn<TRow>[],
  available: number,
): Map<string, number> {
  const sized = visible.filter((col) => col.width !== undefined);
  const widths = new Map(sized.map((col) => [col.id, col.width as number]));
  let excess = sumWidths(widths) + slackMinWidth(visible) - available;
  let shrinkable = sized.filter(
    (col) =>
      col.resizable !== false &&
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

/**
 * Resize one column to `target` px within its fitted layout, without letting
 * the table outgrow its container. Growth takes the slack column's spare room
 * first, then width from the nearest resizable column to the right, down to
 * that column's minimum. Shrinking hands the room back to the slack column, or
 * to the neighbour when there is none.
 */
export function resizeColumnWidth<TRow>(
  visible: ResolvedTableColumn<TRow>[],
  rendered: Map<string, number>,
  id: string,
  target: number,
  available: number,
): Map<string, number> {
  const index = visible.findIndex((col) => col.id === id);
  const current = rendered.get(id);
  if (index < 0 || current === undefined) return rendered;

  const { min, max } = columnWidthBounds(visible[index]);
  const hasSlack = visible.some((col) => col.width === undefined);
  const spare = hasSlack
    ? Math.max(0, available - sumWidths(rendered) - slackMinWidth(visible))
    : 0;
  const neighbour = visible
    .slice(index + 1)
    .find((col) => col.resizable !== false && rendered.has(col.id));
  const neighbourWidth = neighbour ? (rendered.get(neighbour.id) as number) : 0;
  const neighbourBounds = neighbour ? columnWidthBounds(neighbour) : null;

  let delta = Math.min(Math.max(target, min), max) - current;
  let neighbourDelta = 0;
  if (delta > 0) {
    const fromSpare = Math.min(delta, spare);
    const fromNeighbour = neighbourBounds
      ? Math.min(delta - fromSpare, neighbourWidth - neighbourBounds.min)
      : 0;
    delta = fromSpare + fromNeighbour;
    neighbourDelta = -fromNeighbour;
  } else if (!hasSlack) {
    const toNeighbour = neighbourBounds
      ? Math.min(-delta, neighbourBounds.max - neighbourWidth)
      : 0;
    delta = -toNeighbour;
    neighbourDelta = toNeighbour;
  }

  const next = new Map(rendered);
  next.set(id, current + delta);
  if (neighbour && neighbourDelta) {
    next.set(neighbour.id, neighbourWidth + neighbourDelta);
  }
  return next;
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
      // A column the user can't resize has no stored width worth honouring —
      // it is a stale copy of a past default, and it would shadow the current
      // one forever for anyone who has already saved a layout.
      width: clampWidth(
        def,
        (def.resizable === false ? undefined : entry?.width) ??
          def.defaultWidth,
      ),
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
