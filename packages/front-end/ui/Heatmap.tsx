import { CSSProperties, ReactNode, forwardRef, useMemo } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import Text from "@/ui/Text";
import Table, {
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
}

const MIN_STEP = 2;
const MAX_STEP = 8;

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
    ...marginProps
  },
  ref,
) {
  const globalBounds = useMemo(() => {
    if (normalize !== "all") return undefined;
    const numeric = rows
      .flatMap((row) => row.cells.map((c) => c.value))
      .filter((v): v is number => v !== null && !Number.isNaN(v));
    if (numeric.length === 0) return undefined;
    return { min: Math.min(...numeric), max: Math.max(...numeric) };
  }, [normalize, rows]);

  return (
    <div ref={ref} {...marginProps}>
      <Table
        variant="list"
        stickyHeader={stickyHeader}
        className={clsx(styles.heatmap, className)}
      >
        <colgroup>
          <col style={{ width: labelColumnWidth }} />
          {leadingColumns.map((col) => (
            <col key={col.key} style={{ width: col.width ?? "12%" }} />
          ))}
          {columns.map((col) => (
            <col key={col.key} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>{labelHeader}</TableColumnHeader>
            {leadingColumns.map((col) => (
              <TableColumnHeader key={col.key} justify={col.align ?? "start"}>
                {col.header}
              </TableColumnHeader>
            ))}
            {columns.map((col) => (
              <TableColumnHeader key={col.key} justify={col.align ?? "end"}>
                {col.header}
              </TableColumnHeader>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const intensities = normalizeValues(
              row.cells.map((c) => c.value),
              normalize === "all" ? globalBounds : undefined,
            );
            return (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                {leadingColumns.map((col, i) => (
                  <TableCell key={col.key} justify={col.align ?? "start"}>
                    {row.leading?.[i] ?? null}
                  </TableCell>
                ))}
                {row.cells.map((cell, i) => {
                  const column = columns[i];
                  const background = cellBackground(colorScale, intensities[i]);
                  const isEmpty =
                    cell.value === null || Number.isNaN(cell.value);
                  return (
                    <TableCell
                      key={column?.key ?? i}
                      justify={column?.cellAlign ?? column?.align ?? "end"}
                      title={cell.title}
                      style={background}
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
          })}
        </TableBody>
      </Table>
    </div>
  );
});
