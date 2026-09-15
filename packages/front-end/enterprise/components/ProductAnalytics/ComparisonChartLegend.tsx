import type { CSSProperties } from "react";
import type { CompareChartLegendItem } from "@/enterprise/components/ProductAnalytics/comparison-chart";

const ROW_GAP = 8;

type Props = {
  currentLabel: string;
  previousLabel: string;
  items: CompareChartLegendItem[];
  /** ECharts series names currently toggled off. */
  hiddenSeries: Set<string>;
  /**
   * Toggle visibility for a set of series: if any are visible they all hide,
   * otherwise they all show. A single-element array toggles one series; a
   * period's full set toggles the whole row.
   */
  onToggleSeries: (seriesNames: string[]) => void;
  textColor: string;
};

function PeriodPill({
  label,
  hidden,
  onClick,
  textColor,
}: {
  label: string;
  hidden: boolean;
  onClick: () => void;
  textColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 12px",
        borderRadius: 8,
        border: "1px solid var(--gray-a5)",
        background: "var(--gray-a3)",
        color: textColor,
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.2,
        cursor: "pointer",
        whiteSpace: "nowrap",
        opacity: hidden ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

function SwatchRow({
  color,
  name,
  hidden,
  onClick,
  textColor,
}: {
  color: string | undefined;
  name: string;
  hidden: boolean;
  onClick: () => void;
  textColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: 0,
        border: "none",
        background: "none",
        color: textColor,
        fontSize: 13,
        lineHeight: 1.2,
        cursor: "pointer",
        whiteSpace: "nowrap",
        opacity: hidden ? 0.45 : 1,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          borderRadius: 3,
          flexShrink: 0,
          background: hidden ? "var(--gray-a6)" : (color ?? "var(--gray-a8)"),
        }}
      />
      {name}
    </button>
  );
}

export default function ComparisonChartLegend({
  currentLabel,
  previousLabel,
  items,
  hiddenSeries,
  onToggleSeries,
  textColor,
}: Props) {
  const currentSeriesNames = items
    .map((i) => i.currentSeriesName)
    .filter((n): n is string => n !== undefined);
  const previousSeriesNames = items
    .map((i) => i.previousSeriesName)
    .filter((n): n is string => n !== undefined);

  const allHidden = (names: string[]) =>
    names.length > 0 && names.every((n) => hiddenSeries.has(n));

  // Pill column: shrinks to its content (right-aligned, never wraps).
  const labelCellStyle: CSSProperties = {
    textAlign: "right",
    verticalAlign: "top",
    whiteSpace: "nowrap",
    paddingRight: 20,
  };
  // Swatch column: takes the remaining width so the pill column scales down as
  // it grows. The swatches are a plain flex row that wraps onto itself; current
  // and prior don't column-align, they just share the same starting x.
  const swatchCellStyle: CSSProperties = {
    textAlign: "left",
    verticalAlign: "middle",
    width: "100%",
  };
  const swatchRowStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 20,
    rowGap: ROW_GAP,
  };

  const periodRow = (
    pillLabel: string,
    groupNames: string[],
    period: "current" | "previous",
  ) => (
    <tr>
      <td style={labelCellStyle}>
        <PeriodPill
          label={pillLabel}
          hidden={allHidden(groupNames)}
          onClick={() => onToggleSeries(groupNames)}
          textColor={textColor}
        />
      </td>
      <td style={swatchCellStyle}>
        <div style={swatchRowStyle}>
          {items.map((item) => {
            const seriesName =
              period === "current"
                ? item.currentSeriesName
                : item.previousSeriesName;
            if (seriesName === undefined) return null;
            const color =
              period === "current" ? item.currentColor : item.previousColor;
            return (
              <SwatchRow
                key={item.baseName}
                color={color}
                name={item.baseName}
                hidden={hiddenSeries.has(seriesName)}
                onClick={() => onToggleSeries([seriesName])}
                textColor={textColor}
              />
            );
          })}
        </div>
      </td>
    </tr>
  );

  return (
    // Invisible 2-column table: pills on the right of the left column, metric
    // swatches filling the left of the right column. The table sizes to its
    // content and centers, growing outward until it fills the width and the
    // swatch rows wrap. Capped + scrollable so it never crushes the chart.
    <div
      style={{
        padding: "8px 12px 16px",
        flexShrink: 0,
        maxHeight: "35%",
        overflowY: "auto",
      }}
    >
      <table
        style={{
          margin: "0 auto",
          width: "max-content",
          maxWidth: "100%",
          borderCollapse: "separate",
          borderSpacing: "0 6px",
        }}
      >
        <tbody>
          {periodRow(
            `${currentLabel} (current)`,
            currentSeriesNames,
            "current",
          )}
          {periodRow(
            `${previousLabel} (previous)`,
            previousSeriesNames,
            "previous",
          )}
        </tbody>
      </table>
    </div>
  );
}
