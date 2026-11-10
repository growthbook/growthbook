import React, { useEffect, useMemo, useRef, useState } from "react";
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
  // Previous period, index-aligned with `series`. Drawn as a second funnel
  // row under the current one, sharing the step columns and y scale.
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

  // Compare mode sizes its two rows in pixels from the container height.
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setChartHeight(Math.round(entry.contentRect.height)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const option = useMemo(() => {
    if (!series.length || !stepLabels.length) return null;

    // Each series renders as two stacked bars per step:
    //   - the main (solid) bar with the step's count
    //   - a low-opacity "drop-off" bar stacked on top showing how many
    //     users were lost vs. the previous step (0 for step 1)
    // Stacked together they visually reconstruct the previous step's
    // height, making the per-step drop-off legible at a glance.
    //
    // In "percent" scale we feed normalized values to the y-axis but
    // still carry the raw count on each data point so the tooltip can
    // surface actual user numbers alongside the percentage.
    // Compare mode: grid 0 = current period, grid 1 = previous period. The
    // previous row reuses each series name, so one legend click toggles both rows.
    const isPrevious = (axis: number) => axis === 1;
    const buildSeries = (s: FunnelChartSeries, idx: number, axis: number) => {
      // Resolved here rather than by callers: `hexToRgba` below and zrender's
      // hover emphasis both need concrete hex. `textColor` is a dep of this
      // memo, so a theme switch re-resolves the variables to the new values.
      const hex = cssColorToHex(colors[idx % colors.length]);
      const baseColor = isPrevious(axis) ? hexToRgba(hex, 0.55) : hex;
      const stackKey = `stack_${axis}_${idx}`;
      const firstStep = s.counts[0] ?? 0;
      const toY = (n: number) =>
        yAxisScale === "percent"
          ? firstStep > 0
            ? (n / firstStep) * 100
            : 0
          : n;
      const mainSeries = {
        name: s.label,
        data: s.counts.map((count, stepIdx) => ({
          value: toY(count),
          rawCount: count,
          stepIdx,
          seriesIdx: idx,
          axis,
        })),
        type: "bar" as const,
        stack: stackKey,
        xAxisIndex: axis,
        yAxisIndex: axis,
        color: baseColor,
        animation: animate,
        animationDuration: animate ? 300 : 0,
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
          return toY(Math.max(0, prev - count));
        }),
        type: "bar" as const,
        stack: stackKey,
        xAxisIndex: axis,
        yAxisIndex: axis,
        itemStyle: { color: hexToRgba(hex, isPrevious(axis) ? 0.1 : 0.18) },
        // Ghost bars are decorative — don't react to hover, don't get
        // their own tooltip line. The filter in the formatter below
        // keeps them out of the table regardless.
        silent: true,
        tooltip: { show: false },
        animation: animate,
        animationDuration: animate ? 300 : 0,
      };
      return [mainSeries, ghostSeries];
    };
    const seriesConfigs = [
      ...series.flatMap((s, idx) => buildSeries(s, idx, 0)),
      ...(comparison?.series ?? []).flatMap((s, idx) => buildSeries(s, idx, 1)),
    ];

    const xAxisFor = (axis: number, showLabels: boolean) => ({
      type: "category" as const,
      gridIndex: axis,
      data: stepLabels,
      axisLabel: {
        show: showLabels,
        color: textColor,
        interval: 0,
        overflow: "truncate" as const,
        width: 120,
        ...(comparison && series.length === 1
          ? {
              // Single funnel: conversion change (from start) under each step.
              formatter: (label: string, stepIdx: number) => {
                const pct = (s: FunnelChartSeries | undefined) =>
                  s?.counts[0] ? (s.counts[stepIdx] ?? 0) / s.counts[0] : null;
                const cur = pct(series[0]);
                const prev = pct(comparison.series[0]);
                if (stepIdx === 0 || cur === null || prev === null) {
                  return label;
                }
                const d = (cur - prev) * 100;
                return `${label}\n{${d >= 0 ? "up" : "down"}|${d >= 0 ? "+" : ""}${d.toFixed(1)} pts}`;
              },
              rich: {
                up: {
                  color: cssColorToHex("var(--green-11)"),
                  padding: [4, 0, 0, 0],
                },
                down: {
                  color: cssColorToHex("var(--red-11)"),
                  padding: [4, 0, 0, 0],
                },
              },
            }
          : {}),
      },
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    });
    const yAxisFor = (
      axis: number,
      name: string | undefined,
      max?: number,
    ) => ({
      type: "value" as const,
      gridIndex: axis,
      name,
      nameLocation: "end" as const,
      nameGap: 12,
      nameTextStyle: {
        color: textColor,
        align: "left" as const,
        fontWeight: 500,
      },
      axisLabel: {
        color: textColor,
        formatter: (v: number) =>
          yAxisScale === "percent" ? `${Math.round(v)}%` : formatNumber(v),
      },
      // Percent mode anchors at 0–100 (drop-off ghosts can push series
      // totals to exactly 100, so we don't need a hard max).
      min: 0,
      max,
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    });
    // Two stacked funnels with one shared y scale, so bar heights compare
    // across rows. Linked axis pointers highlight a step in both rows.
    const compareAxes = () => {
      const all = [...series, ...(comparison?.series ?? [])];
      const max =
        yAxisScale === "percent"
          ? 100
          : Math.max(1, ...all.map((s) => s.counts[0] ?? 0));
      // Equal pixel heights, so the same value is the same bar height in
      // both rows. Room for the legend, row titles, and step labels.
      const top = series.length > 1 ? 72 : 32;
      const bottom = series.length === 1 ? 52 : 36;
      const gap = 40;
      const rowHeight = Math.max(40, (chartHeight - top - bottom - gap) / 2);
      return {
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: [
          { left: 56, right: 24, top, height: rowHeight },
          {
            left: 56,
            right: 24,
            top: top + rowHeight + gap,
            height: rowHeight,
          },
        ],
        xAxis: [xAxisFor(0, false), xAxisFor(1, true)],
        yAxis: [
          yAxisFor(0, comparison?.currentLabel, max),
          yAxisFor(1, comparison?.previousLabel, max),
        ],
      };
    };

    return {
      tooltip: {
        appendTo: "body",
        // Compare mode lists 3 rows per series; keep tall tooltips on screen.
        confine: true,
        trigger: "axis",
        padding: [10, 14],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const raw = (Array.isArray(params) ? params : [params]) as {
            seriesName: string;
            marker: string;
            value: number;
            dataIndex: number;
            data?: {
              stepIdx?: number;
              seriesIdx?: number;
              rawCount?: number;
              axis?: number;
            };
          }[];
          // Drop-off ghost bars share the axis-trigger but shouldn't
          // appear as their own rows in the tooltip table.
          const items = raw.filter(
            (i) => !i.seriesName.startsWith(DROPOFF_SERIES_PREFIX),
          );
          if (!items.length) return "";
          const stepIdx = items[0].dataIndex;
          const header = stepLabels[stepIdx] ?? `Step ${stepIdx + 1}`;
          // Single row per series keeps the tooltip compact when several
          // series are stacked at the same step. First step's "from prev"
          // and "avg time" don't apply, so we render em-dashes there to
          // keep column alignment consistent across rows.
          const headerCell =
            "padding:2px 8px 4px 0;font-weight:600;text-align:left;border-bottom:1px solid var(--gray-a4)";
          const numHeaderCell =
            "padding:2px 0 4px 8px;font-weight:600;text-align:right;border-bottom:1px solid var(--gray-a4)";
          const labelCell = "padding:3px 8px 3px 0;text-align:left";
          const numCell = "padding:3px 0 3px 8px;text-align:right";
          const stats = (s: FunnelChartSeries | undefined) => {
            const count = s?.counts[stepIdx] ?? 0;
            const first = s?.counts[0] ?? 0;
            const prev = stepIdx > 0 ? (s?.counts[stepIdx - 1] ?? 0) : 0;
            return {
              count,
              fromStart: first > 0 ? count / first : null,
              fromPrev: prev > 0 ? count / prev : null,
              avgMs: s?.avgTimes[stepIdx] ?? null,
            };
          };
          const row = (label: string, st: ReturnType<typeof stats>) =>
            `<tr><td style="${labelCell}">${label}</td><td style="${numCell}"><b>${formatNumber(st.count)}</b></td><td style="${numCell}">${formatPct(st.fromStart)}</td><td style="${numCell}">${stepIdx === 0 ? "—" : formatPct(st.fromPrev)}</td><td style="${numCell}">${stepIdx === 0 ? "—" : formatDurationMs(st.avgMs)}</td></tr>`;
          const signed = (v: number | null, unit: string) =>
            v === null || !Number.isFinite(v)
              ? "—"
              : `<span style="color:var(--${v >= 0 ? "green" : "red"}-11)">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}${unit}</span>`;
          const diff = (a: number | null, b: number | null) =>
            a === null || b === null ? null : a - b;
          const rows = items
            .filter((item) => item.data?.axis !== 1)
            .map((item) => {
              const sIdx = item.data?.seriesIdx ?? 0;
              const cur = stats(series[sIdx]);
              if (!comparison) {
                return row(`${item.marker}${item.seriesName}`, cur);
              }
              // Rows: current, previous, then the change between them.
              const prev = stats(comparison.series[sIdx]);
              const prevMarker =
                items.find(
                  (i) => i.data?.axis === 1 && i.data?.seriesIdx === sIdx,
                )?.marker ?? "";
              const muted = (t: string) =>
                `<span style="color:var(--gray-11)">${t}</span>`;
              return (
                row(
                  `${item.marker}${series.length > 1 ? item.seriesName : "Current"}`,
                  cur,
                ) +
                row(`${prevMarker}${muted("Previous")}`, prev) +
                `<tr><td style="${labelCell};color:var(--gray-11)">Change</td><td style="${numCell}">${signed(prev.count > 0 ? cur.count / prev.count - 1 : null, "%")}</td><td style="${numCell}">${stepIdx === 0 ? "—" : signed(diff(cur.fromStart, prev.fromStart), " pts")}</td><td style="${numCell}">${stepIdx === 0 ? "—" : signed(diff(cur.fromPrev, prev.fromPrev), " pts")}</td><td style="${numCell}"></td></tr>`
              );
            })
            .join("");
          const periods = comparison
            ? `<div style="color:var(--gray-11)">${comparison.currentLabel} vs ${comparison.previousLabel}</div>`
            : "";
          return `<div><div style="margin-bottom:6px"><b>${header}</b>${periods}</div><table style="border-collapse:collapse;font-size:inherit"><thead><tr><th style="${headerCell}"></th><th style="${numHeaderCell}">Count</th><th style="${numHeaderCell}">From start</th><th style="${numHeaderCell}">From prev</th><th style="${numHeaderCell}">Avg time</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        },
      },
      legend: {
        show: series.length > 1,
        // Whitelist only the main series names so the drop-off ghosts
        // don't pollute the legend.
        data: series.map((s) => s.label),
        top: 8,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
      },
      ...(comparison
        ? compareAxes()
        : {
            grid: {
              left: "8%",
              right: "5%",
              top: series.length > 1 ? 52 : "8%",
              bottom: "10%",
            },
            xAxis: xAxisFor(0, true),
            yAxis: yAxisFor(0, undefined),
          }),
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
    chartHeight,
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
    <Box
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, position: "relative" }}
    >
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
