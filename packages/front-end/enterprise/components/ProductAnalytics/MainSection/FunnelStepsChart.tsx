import React, { useMemo, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { formatDurationMs } from "@/enterprise/components/ProductAnalytics/util";
import {
  CHART_COLORS,
  cssColorToHex,
  getChartThemeColors,
} from "@/components/DataViz/chart-theme";
import Text from "@/ui/Text";

/** Convert a `#rrggbb` hex into `rgba(…)` with the given alpha. Used to
 *  paint the drop-off ghost bar in the same hue as its main series at a
 *  much lower opacity. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Series name prefix for drop-off ghost bars — used to exclude them from
 *  the legend and the tooltip's table. */
const DROPOFF_SERIES_PREFIX = "__dropoff_";

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export interface FunnelChartSeries {
  /** Stable identity for legend toggling. */
  key: string;
  /** Label shown in the legend/tooltip. */
  label: string;
  /** Counts per step in step order. */
  counts: number[];
  /** Avg time-from-previous-step in ms per step (null for step 0 / no data). */
  avgTimes: (number | null)[];
}

// Share of step-1 users who reached `stepIdx`; null when step 1 is empty.
function fromStartRate(
  s: FunnelChartSeries | undefined,
  stepIdx: number,
): number | null {
  const first = s?.counts[0] ?? 0;
  return first > 0 ? (s?.counts[stepIdx] ?? 0) / first : null;
}

// Share of the previous step's users who reached `stepIdx`.
function fromPrevRate(
  s: FunnelChartSeries | undefined,
  stepIdx: number,
): number | null {
  const prev = stepIdx > 0 ? (s?.counts[stepIdx - 1] ?? 0) : 0;
  return prev > 0 ? (s?.counts[stepIdx] ?? 0) / prev : null;
}

// Rounds to 1 decimal; `|| 0` folds -0 into 0.
const round1 = (d: number) => Math.round(d * 10) / 10 || 0;
const signed = (d: number) => `${d > 0 ? "+" : ""}${d.toFixed(1)}`;
const tone = (d: number) => (d > 0 ? "green" : d < 0 ? "red" : "gray");

// Compare-mode change for one bar:
// - step 1: % change in users
// - later steps: change in conversion from start, in pts
function stepChange(
  cur: FunnelChartSeries,
  prev: FunnelChartSeries | undefined,
  stepIdx: number,
): number | null {
  if (stepIdx === 0) {
    const p = prev?.counts[0] ?? 0;
    return p > 0 ? round1(((cur.counts[0] ?? 0) / p - 1) * 100) : null;
  }
  const a = fromStartRate(cur, stepIdx);
  const b = fromStartRate(prev, stepIdx);
  return a === null || b === null ? null : round1((a - b) * 100);
}

export default function FunnelStepsChart({
  stepLabels,
  series,
  comparison,
  yAxisScale = "percent",
  animate = true,
  colors = CHART_COLORS,
}: {
  stepLabels: string[];
  series: FunnelChartSeries[];
  // Previous period, index-aligned with `series`. Each bar gets a marker at
  // its previous-period value and the change written above it.
  comparison?: {
    series: FunnelChartSeries[];
    currentLabel: string;
    previousLabel: string;
  };
  yAxisScale?: "count" | "percent";
  animate?: boolean;
  // Per-series bar colors in series order, wrapping if fewer than series.
  // Any CSS color, including `var(--…)` references.
  colors?: string[];
}) {
  const { theme } = useAppearanceUITheme();
  const { textColor, tooltipBackgroundColor, gridLineColor } =
    getChartThemeColors(theme);

  const option = useMemo(() => {
    if (!series.length || !stepLabels.length) return null;

    // Resolved here rather than by callers: `hexToRgba` below and zrender's
    // hover emphasis both need concrete hex. `textColor` is a dep of this
    // memo, so a theme switch re-resolves the variables to the new values.
    const colorOf = (idx: number) => cssColorToHex(colors[idx % colors.length]);
    const toneHex = {
      green: cssColorToHex("var(--green-11)"),
      red: cssColorToHex("var(--red-11)"),
      gray: cssColorToHex("var(--gray-11)"),
    };
    // "percent" normalizes each series so step 1 = 100%; "count" keeps raw
    // counts. The tooltip reads raw counts from the series props.
    const scale = (s: FunnelChartSeries) => (n: number) =>
      yAxisScale === "percent"
        ? (s.counts[0] ?? 0) > 0
          ? (n / s.counts[0]) * 100
          : 0
        : n;
    const anim = {
      animation: animate,
      animationDuration: animate ? 300 : 0,
    };
    // Bars and previous-period markers are laid out per series type, so both
    // need the same gaps to line up.
    const barLayout = { barGap: "30%", barCategoryGap: "20%" };

    // Each series renders as two stacked bars per step:
    //   - the main (solid) bar with the step's count
    //   - a low-opacity "drop-off" bar stacked on top showing how many
    //     users were lost vs. the previous step (0 for step 1)
    // Compare mode adds a marker series at the previous-period values. The
    // change label sits on whichever of bar or marker is taller.
    const seriesConfigs = series.flatMap((s, idx) => {
      const baseColor = colorOf(idx);
      const stackKey = `stack_${idx}`;
      const curY = s.counts.map(scale(s));
      const prevS = comparison?.series[idx];
      const prevY = prevS ? prevS.counts.map(scale(prevS)) : null;
      const changeLabel = (stepIdx: number) => {
        const d = stepChange(s, prevS, stepIdx);
        if (d === null) return { show: false };
        return {
          show: true,
          position: "top" as const,
          distance: 2,
          formatter: `${signed(d)}${stepIdx === 0 ? "%" : ""}`,
          color: toneHex[tone(d)],
          fontWeight: 600,
          fontSize: 11,
        };
      };
      const mainSeries = {
        name: s.label,
        data: curY.map((value, stepIdx) => ({
          value,
          stepIdx,
          seriesIdx: idx,
          ...(prevY && value >= prevY[stepIdx]
            ? { label: changeLabel(stepIdx) }
            : {}),
        })),
        type: "bar" as const,
        stack: stackKey,
        color: baseColor,
        labelLayout: { hideOverlap: true },
        ...barLayout,
        ...anim,
      };
      const ghostSeries = {
        // Distinct, predictable name so we can filter it out of legend
        // and tooltip without exposing it to the user.
        name: `${DROPOFF_SERIES_PREFIX}${idx}`,
        data: s.counts.map((count, stepIdx) => {
          if (stepIdx === 0) return 0;
          const prev = s.counts[stepIdx - 1] ?? 0;
          // Funnel counts should be monotonically non-increasing, but
          // clamp defensively so any data anomaly doesn't push the ghost
          // below zero (which would render below the main bar).
          return scale(s)(Math.max(0, prev - count));
        }),
        type: "bar" as const,
        stack: stackKey,
        itemStyle: { color: hexToRgba(baseColor, 0.18) },
        // Ghost bars are decorative — don't react to hover, don't get
        // their own tooltip line. The filter in the formatter below
        // keeps them out of the table regardless.
        silent: true,
        tooltip: { show: false },
        ...barLayout,
        ...anim,
      };
      if (!prevY) return [mainSeries, ghostSeries];
      // Same name as the bar, so one legend click hides both.
      const markerSeries = {
        name: s.label,
        type: "pictorialBar" as const,
        symbol: "rect",
        symbolSize: ["116%", 2],
        symbolPosition: "end" as const,
        itemStyle: { color: textColor },
        z: 3,
        silent: true,
        data: prevY.map((value, stepIdx) => ({
          value,
          stepIdx,
          seriesIdx: idx,
          ...(value > curY[stepIdx] ? { label: changeLabel(stepIdx) } : {}),
        })),
        labelLayout: { hideOverlap: true },
        ...barLayout,
        ...anim,
      };
      return [mainSeries, ghostSeries, markerSeries];
    });

    // Wide compare tooltip: one row per series, column groups side by side.
    // One row per series, column groups side by side. Without compare,
    // each group keeps only its "Now" column.
    const stepTooltip = (stepIdx: number, seriesIdxs: number[]) => {
      type S = FunnelChartSeries | undefined;
      const muted = "color:var(--gray-11)";
      const pill = (d: number | null) => {
        if (d === null) return "—";
        const arrow = d > 0 ? "▲ " : d < 0 ? "▼ " : "";
        return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-weight:600;background:var(--${tone(d)}-a3);color:var(--${tone(d)}-11)"><span style="font-size:0.7em">${arrow}</span>${signed(d)} pts</span>`;
      };
      const usersChange = (a: number, b: number) => {
        if (b <= 0) return "—";
        const d = round1((a / b - 1) * 100);
        return `<span style="color:var(--${tone(d)}-11)">${signed(d)}%</span>`;
      };
      const timeChange = (a: number | null, b: number | null) =>
        a === null || b === null
          ? ""
          : `${a >= b ? "+" : "−"}${formatDurationMs(Math.abs(a - b))}`;
      const rateGroup = (
        title: string,
        rate: (s: S, i: number) => number | null,
      ) => ({
        title,
        cols: [
          {
            head: "Now",
            cell: (c: S) => `<b>${formatPct(rate(c, stepIdx))}</b>`,
          },
          { head: "Prev", cell: (_: S, p: S) => formatPct(rate(p, stepIdx)) },
          {
            head: "Change",
            cell: (c: S, p: S) => {
              const a = rate(c, stepIdx);
              const b = rate(p, stepIdx);
              return pill(
                a === null || b === null ? null : round1((a - b) * 100),
              );
            },
          },
        ],
      });
      const count = (s: S) => s?.counts[stepIdx] ?? 0;
      const avg = (s: S) => s?.avgTimes[stepIdx] ?? null;
      // Step 1 is 100% for everyone, so it only shows users. On step 2,
      // from previous step equals from start, so it's left out.
      const compareGroups = [
        ...(stepIdx > 0
          ? [rateGroup("Conversion from start", fromStartRate)]
          : []),
        ...(stepIdx > 1
          ? [rateGroup("Conversion from previous step", fromPrevRate)]
          : []),
        {
          title: "Users",
          cols: [
            { head: "Now", cell: (c: S) => `<b>${formatNumber(count(c))}</b>` },
            { head: "Prev", cell: (_: S, p: S) => formatNumber(count(p)) },
            {
              head: "Change",
              cell: (c: S, p: S) => usersChange(count(c), count(p)),
            },
          ],
        },
        ...(stepIdx > 0
          ? [
              {
                title: "Avg time",
                cols: [
                  { head: "Now", cell: (c: S) => formatDurationMs(avg(c)) },
                  {
                    head: "Change",
                    cell: (c: S, p: S) =>
                      `<span style="${muted}">${timeChange(avg(c), avg(p))}</span>`,
                  },
                ],
              },
            ]
          : []),
      ];
      // Without compare: the same columns as before, restyled.
      const col = (title: string, cell: (c: S) => string) => ({
        title,
        cols: [{ head: title, cell }],
      });
      const dashOnFirst = (v: string) => (stepIdx === 0 ? "—" : v);
      const groups = comparison
        ? compareGroups
        : [
            col("Count", (c) => `<b>${formatNumber(count(c))}</b>`),
            col("From start", (c) => formatPct(fromStartRate(c, stepIdx))),
            col("From prev", (c) =>
              dashOnFirst(formatPct(fromPrevRate(c, stepIdx))),
            ),
            col("Avg time", (c) => dashOnFirst(formatDurationMs(avg(c)))),
          ];
      // Extra left padding on each group's first column separates groups.
      const cellStyle = (colIdx: number) =>
        `padding:5px 0 5px ${colIdx === 0 ? 28 : 16}px;text-align:right;white-space:nowrap`;
      const groupRow = groups
        .map(
          (g) =>
            `<th colspan="${g.cols.length}" style="padding:0 0 0 28px;text-align:${g.cols.length > 1 ? "left" : "right"}"><div style="padding-bottom:4px;border-bottom:1px solid var(--gray-a5);font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;${muted}">${g.title}</div></th>`,
        )
        .join("");
      const headRow = groups
        .flatMap((g) =>
          g.cols.map(
            (c, i) =>
              `<th style="${cellStyle(i)};font-weight:500;${muted}">${c.head}</th>`,
          ),
        )
        .join("");
      const rows = seriesIdxs
        .map((sIdx) => {
          const c = series[sIdx];
          const p = comparison?.series[sIdx];
          const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;flex-shrink:0;background:${colorOf(sIdx)}"></span>`;
          const cells = groups
            .flatMap((g) =>
              g.cols.map(
                (col, i) =>
                  `<td style="${cellStyle(i)}">${col.cell(c, p)}</td>`,
              ),
            )
            .join("");
          return `<tr><td style="padding:5px 0;max-width:140px"><div style="display:flex;align-items:center;white-space:normal">${swatch}${c?.label ?? ""}</div></td>${cells}</tr>`;
        })
        .join("");
      // `width:0;min-width:100%` wraps the note to the table's width
      // instead of widening the tooltip.
      const footnote =
        comparison && stepIdx === 1
          ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--gray-a4);white-space:normal;width:0;min-width:100%;${muted}">Conversion from previous step is hidden here because it equals conversion from start on this step.</div>`
          : "";
      const periods = comparison
        ? `<span style="${muted}"><b style="color:var(--gray-12)">Now</b> ${comparison.currentLabel} · <b style="color:var(--gray-12)">Prev</b> ${comparison.previousLabel}</span>`
        : "";
      return `<div><div style="display:flex;justify-content:space-between;align-items:baseline;gap:32px;margin-bottom:10px"><b style="font-size:1.1em">${stepLabels[stepIdx] ?? `Step ${stepIdx + 1}`}</b>${periods}</div><table style="border-collapse:collapse;font-size:inherit"><thead><tr><th></th>${groupRow}</tr>${comparison ? `<tr><th></th>${headRow}</tr>` : ""}</thead><tbody>${rows}</tbody></table>${footnote}</div>`;
    };

    return {
      tooltip: {
        appendTo: "body",
        // The table is wide; keep it on screen.
        confine: true,
        trigger: "axis",
        padding: [12, 16],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const raw = (Array.isArray(params) ? params : [params]) as {
            seriesName: string;
            dataIndex: number;
            data?: { seriesIdx?: number };
          }[];
          // Drop-off ghost bars share the axis-trigger but shouldn't
          // appear as their own rows in the tooltip table.
          const items = raw.filter(
            (i) => !i.seriesName.startsWith(DROPOFF_SERIES_PREFIX),
          );
          if (!items.length) return "";
          const stepIdx = items[0].dataIndex;
          // Bar and marker both report each visible series; keep one.
          const seen = new Set<number>();
          const visible = items.filter((i) => {
            const sIdx = i.data?.seriesIdx ?? 0;
            if (seen.has(sIdx)) return false;
            seen.add(sIdx);
            return true;
          });
          return stepTooltip(
            stepIdx,
            visible.map((i) => i.data?.seriesIdx ?? 0),
          );
        },
      },
      // Compare-mode key, top left: current swatch, previous marker, change.
      ...(comparison
        ? {
            title: {
              left: 8,
              top: 14,
              text: `{cur| }{label|${comparison.currentLabel}}{prev| }{muted|${comparison.previousLabel} (previous)}{up|±}{muted|Change vs previous}`,
              textStyle: {
                fontSize: 13,
                fontWeight: "normal" as const,
                rich: {
                  cur: {
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: toneHex.gray,
                  },
                  label: {
                    color: textColor,
                    fontWeight: 600,
                    padding: [0, 20, 0, 6],
                  },
                  prev: { width: 14, height: 2, backgroundColor: textColor },
                  muted: { color: toneHex.gray, padding: [0, 20, 0, 6] },
                  up: { color: toneHex.green, fontWeight: 600 },
                },
              },
            },
          }
        : {}),
      legend: {
        show: series.length > 1,
        // Whitelist only the main series names so the drop-off ghosts
        // don't pollute the legend.
        data: series.map((s) => s.label),
        top: 8,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
        ...(comparison ? { right: 8, width: "45%" } : {}),
      },
      grid: comparison
        ? { left: 56, right: 24, top: 72, bottom: 36 }
        : {
            left: "8%",
            right: "5%",
            top: series.length > 1 ? 52 : "8%",
            bottom: "10%",
          },
      xAxis: {
        type: "category",
        data: stepLabels,
        axisLabel: {
          color: textColor,
          interval: 0,
          overflow: "truncate",
          width: 120,
        },
        splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          formatter: (v: number) =>
            yAxisScale === "percent" ? `${Math.round(v)}%` : formatNumber(v),
        },
        // Percent mode anchors at 0–100; markers and labels would
        // otherwise stretch the axis past 100.
        min: 0,
        max: yAxisScale === "percent" ? 100 : undefined,
        splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
      },
      series: seriesConfigs,
    };
  }, [
    series,
    comparison,
    stepLabels,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
    yAxisScale,
    colors,
  ]);

  // Mirror legend toggles onto the matching low-opacity drop-off ghost so
  // hiding a series also hides its previous-step shadow. The ghost series
  // aren't in `legend.data`, so ECharts' default click handler doesn't
  // reach them — we dispatch the action ourselves.
  const chartRef = useRef<EChartsReact>(null);
  const onEvents = useMemo(
    () => ({
      legendselectchanged: (params: {
        name: string;
        selected: Record<string, boolean>;
      }) => {
        const idx = series.findIndex((s) => s.label === params.name);
        if (idx === -1) return;
        const instance = chartRef.current?.getEchartsInstance();
        if (!instance) return;
        instance.dispatchAction({
          type: params.selected[params.name]
            ? "legendSelect"
            : "legendUnSelect",
          name: `${DROPOFF_SERIES_PREFIX}${idx}`,
        });
      },
    }),
    [series],
  );

  // `option` is null exactly when there are no steps or no series, so this
  // one guard both renders the empty state and narrows `option` below.
  if (!option) {
    return (
      <Flex
        p="4"
        style={{ flex: 1, minHeight: 0 }}
        align="center"
        justify="center"
      >
        <Text color="text-mid" weight="medium">
          No data to display.
        </Text>
      </Flex>
    );
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <EChartsReact
        ref={chartRef}
        key={JSON.stringify(option)}
        option={{
          ...option,
          ...(animate ? {} : { animation: false }),
          padding: [0, 0, 0, 0],
        }}
        style={{ width: "100%", height: "100%" }}
        onEvents={onEvents}
      />
    </Box>
  );
}
