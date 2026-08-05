import {
  CSSProperties,
  ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import Text from "@/ui/Text";
import Table, {
  DEFAULT_STICKY_TOP_OFFSET_PX,
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import styles from "./Heatmap.module.scss";

/**
 * Radix accent color scales that the heatmap can tint cells with. Each maps to
 * the global `--<scale>-N` design tokens, so the gradient adapts to light/dark
 * theme automatically (no hardcoded hex).
 */
export type HeatmapColorScale =
  | "violet"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "pink"
  | "gray";

export type HeatmapAlign = "start" | "center" | "end";

export interface HeatmapCellData {
  value: number | null;
  display?: ReactNode;
  title?: string;
}

export interface HeatmapColumn {
  key: string;
  header: ReactNode;
  align?: HeatmapAlign;
  cellAlign?: HeatmapAlign;
}

export interface HeatmapLeadingColumn {
  key: string;
  header?: ReactNode;
  align?: HeatmapAlign;
  width?: string;
  frozenWidth?: number;
}

export interface HeatmapRow {
  key: string;
  label: ReactNode;
  cells: HeatmapCellData[];
  leading?: ReactNode[];
}

export interface HeatmapProps extends MarginProps {
  columns: HeatmapColumn[];
  rows: HeatmapRow[];
  labelHeader?: ReactNode;
  leadingColumns?: HeatmapLeadingColumn[];
  labelColumnWidth?: string;
  normalize?: "row" | "all";
  colorScale?: HeatmapColorScale;
  formatValue?: (value: number) => string;
  emptyDisplay?: ReactNode;
  stickyHeader?: boolean;
  className?: string;
  /**
   * When true, the value columns get a minimum pixel width and the whole table
   * scrolls horizontally inside an overflow container instead of squeezing
   * columns to fit. Use for tables with many value columns (e.g. many bandit
   * variations).
   */
  scrollable?: boolean;
  /** Minimum pixel width for each value column in `scrollable` mode. */
  minColumnWidth?: number;
  /**
   * When `scrollable`, freeze the label column and any leading columns to the
   * left (Excel-style) so they stay visible while value columns scroll.
   * Defaults to true.
   */
  freezeColumns?: boolean;
  /** Fixed pixel width for the frozen label column in `scrollable` mode. */
  frozenLabelWidth?: number;
  /**
   * Top offset (px) the sticky header pins to in `scrollable` mode. Should match
   * the top nav height. Defaults to `DEFAULT_STICKY_TOP_OFFSET_PX`.
   */
  stickyTopOffset?: number;
}

const MIN_STEP = 2;
const MAX_STEP = 8;

const DEFAULT_MIN_COLUMN_WIDTH = 96;
const DEFAULT_FROZEN_LABEL_WIDTH = 240;
const DEFAULT_FROZEN_LEADING_WIDTH = 120;

function intensityToStep(intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return MIN_STEP + Math.round(clamped * (MAX_STEP - MIN_STEP));
}

function cellBackground(
  scale: HeatmapColorScale,
  intensity: number | null,
): CSSProperties | undefined {
  if (intensity === null || Number.isNaN(intensity)) return undefined;
  const step = intensityToStep(intensity);
  return {
    backgroundColor: `var(--${scale}-a${step})`,
  };
}

function normalizeValues(
  values: (number | null)[],
  bounds?: { min: number; max: number },
): (number | null)[] {
  const numeric = values.filter(
    (v): v is number => v !== null && !Number.isNaN(v),
  );
  if (numeric.length === 0) return values.map(() => null);
  const min = bounds ? bounds.min : Math.min(...numeric);
  const max = bounds ? bounds.max : Math.max(...numeric);
  const range = max - min;
  return values.map((v) => {
    if (v === null || Number.isNaN(v)) return null;
    if (range === 0) return 0;
    return (v - min) / range;
  });
}

const defaultFormatValue = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

/**
 * Reusable heat-map table. Renders a label column, optional descriptive
 * (non-tinted) leading columns, and a grid of value columns whose background
 * intensity scales with the cell value. Color intensity increases with the
 * value, using design-system accent tokens so it adapts to light/dark themes.
 */
export default forwardRef<HTMLDivElement, HeatmapProps>(function Heatmap(
  {
    columns,
    rows,
    labelHeader,
    leadingColumns = [],
    labelColumnWidth = "38%",
    normalize = "row",
    colorScale = "indigo",
    formatValue = defaultFormatValue,
    emptyDisplay = "—",
    stickyHeader,
    className,
    scrollable = false,
    minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
    freezeColumns = true,
    frozenLabelWidth = DEFAULT_FROZEN_LABEL_WIDTH,
    stickyTopOffset = DEFAULT_STICKY_TOP_OFFSET_PX,
    ...marginProps
  },
  ref,
) {
  const freeze = scrollable && freezeColumns;

  // In scrollable mode the header and body are rendered as two aligned tables so
  // the header can pin to the page (sticky) while the body scrolls horizontally.
  // We keep the header's horizontal scroll offset in sync with the body's.
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollable) return;
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (!body || !header) return;
    const sync = () => {
      header.scrollLeft = body.scrollLeft;
    };
    sync();
    body.addEventListener("scroll", sync, { passive: true });
    return () => body.removeEventListener("scroll", sync);
  }, [scrollable]);

  // Fixed pixel widths for the frozen columns so their sticky-left offsets are
  // stable. The label column is frozen first (left: 0), then each leading
  // column stacks to its right.
  const leadingFrozenWidths = leadingColumns.map(
    (col) => col.frozenWidth ?? DEFAULT_FROZEN_LEADING_WIDTH,
  );
  const leadingFrozenLefts = useMemo(() => {
    const lefts: number[] = [];
    let acc = frozenLabelWidth;
    for (const w of leadingFrozenWidths) {
      lefts.push(acc);
      acc += w;
    }
    return lefts;
  }, [frozenLabelWidth, leadingFrozenWidths]);

  // The right-most frozen column gets a divider shadow to separate it from the
  // scrolling value columns.
  const labelIsLastFrozen = freeze && leadingColumns.length === 0;

  const frozenColumnStyle = (
    width: number,
    left: number,
    isLast: boolean,
  ): CSSProperties => ({
    left,
    width,
    minWidth: width,
    maxWidth: width,
    ...(isLast
      ? { boxShadow: "inset -1px 0 0 0 var(--slate-a5, rgba(0, 9, 50, 0.12))" }
      : {}),
  });

  const valueColumnStyle: CSSProperties | undefined = scrollable
    ? { minWidth: minColumnWidth }
    : undefined;

  const globalBounds = useMemo(() => {
    if (normalize !== "all") return undefined;
    const numeric = rows
      .flatMap((row) => row.cells.map((c) => c.value))
      .filter((v): v is number => v !== null && !Number.isNaN(v));
    if (numeric.length === 0) return undefined;
    return { min: Math.min(...numeric), max: Math.max(...numeric) };
  }, [normalize, rows]);

  const colGroup = (
    <colgroup>
      <col
        style={{
          width: freeze ? frozenLabelWidth : labelColumnWidth,
        }}
      />
      {leadingColumns.map((col, i) => (
        <col
          key={col.key}
          style={{
            width: freeze ? leadingFrozenWidths[i] : (col.width ?? "12%"),
          }}
        />
      ))}
      {columns.map((col) => (
        <col
          key={col.key}
          style={scrollable ? { width: minColumnWidth } : undefined}
        />
      ))}
    </colgroup>
  );

  const headerRow = (
    <TableRow>
      <TableColumnHeader
        className={freeze ? styles.frozenColumn : undefined}
        style={
          freeze
            ? frozenColumnStyle(frozenLabelWidth, 0, labelIsLastFrozen)
            : undefined
        }
      >
        {labelHeader}
      </TableColumnHeader>
      {leadingColumns.map((col, i) => (
        <TableColumnHeader
          key={col.key}
          justify={col.align ?? "start"}
          className={freeze ? styles.frozenColumn : undefined}
          style={
            freeze
              ? frozenColumnStyle(
                  leadingFrozenWidths[i],
                  leadingFrozenLefts[i],
                  i === leadingColumns.length - 1,
                )
              : undefined
          }
        >
          {col.header}
        </TableColumnHeader>
      ))}
      {columns.map((col) => (
        <TableColumnHeader
          key={col.key}
          justify={col.align ?? "end"}
          style={valueColumnStyle}
        >
          {col.header}
        </TableColumnHeader>
      ))}
    </TableRow>
  );

  const bodyRows = rows.map((row) => {
    const intensities = normalizeValues(
      row.cells.map((c) => c.value),
      normalize === "all" ? globalBounds : undefined,
    );
    return (
      <TableRow key={row.key}>
        <TableCell
          className={freeze ? styles.frozenColumn : undefined}
          style={
            freeze
              ? frozenColumnStyle(frozenLabelWidth, 0, labelIsLastFrozen)
              : undefined
          }
        >
          {row.label}
        </TableCell>
        {leadingColumns.map((col, i) => (
          <TableCell
            key={col.key}
            justify={col.align ?? "start"}
            className={freeze ? styles.frozenColumn : undefined}
            style={
              freeze
                ? frozenColumnStyle(
                    leadingFrozenWidths[i],
                    leadingFrozenLefts[i],
                    i === leadingColumns.length - 1,
                  )
                : undefined
            }
          >
            {row.leading?.[i] ?? null}
          </TableCell>
        ))}
        {row.cells.map((cell, i) => {
          const column = columns[i];
          const background = cellBackground(colorScale, intensities[i]);
          const isEmpty = cell.value === null || Number.isNaN(cell.value);
          return (
            <TableCell
              key={column?.key ?? i}
              justify={column?.cellAlign ?? column?.align ?? "end"}
              title={cell.title}
              style={
                background || valueColumnStyle
                  ? { ...background, ...valueColumnStyle }
                  : undefined
              }
              className={background ? styles.cell : undefined}
            >
              {isEmpty ? (
                <Text size="medium" color="text-low">
                  {cell.display ?? emptyDisplay}
                </Text>
              ) : (
                <Text size="medium">
                  {cell.display ?? formatValue(cell.value as number)}
                </Text>
              )}
            </TableCell>
          );
        })}
      </TableRow>
    );
  });

  // Scrollable mode: render the header and body as two column-aligned tables so
  // the header can pin to the page (position: sticky) while only the body scrolls
  // horizontally. The header's horizontal offset is JS-synced to the body scroll
  // (see the effect above), and frozen columns stay pinned in both.
  if (scrollable) {
    return (
      <div ref={ref} {...marginProps} className={styles.scrollWrap}>
        <div
          ref={headerScrollRef}
          className={styles.stickyHeader}
          style={{ top: stickyTopOffset }}
        >
          <Table
            variant="list"
            stickyHeader={false}
            className={clsx(
              styles.heatmap,
              styles.scrollTable,
              styles.scrollHeaderTable,
              className,
            )}
          >
            {colGroup}
            <TableHeader>{headerRow}</TableHeader>
          </Table>
        </div>
        <div ref={bodyScrollRef} className={styles.scrollBody}>
          <Table
            variant="list"
            stickyHeader={false}
            className={clsx(
              styles.heatmap,
              styles.scrollTable,
              styles.scrollBodyTable,
              className,
            )}
          >
            {colGroup}
            <TableBody>{bodyRows}</TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} {...marginProps}>
      <Table
        variant="list"
        stickyHeader={stickyHeader}
        className={clsx(styles.heatmap, className)}
      >
        {colGroup}
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>{bodyRows}</TableBody>
      </Table>
    </div>
  );
});
