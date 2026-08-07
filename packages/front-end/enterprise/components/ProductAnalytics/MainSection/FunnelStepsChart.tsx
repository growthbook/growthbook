import React, { useMemo, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { formatDurationMs } from "@/enterprise/components/ProductAnalytics/util";
import {
  CHART_COLORS,
  getChartThemeColors,
} from "@/enterprise/components/ProductAnalytics/chart-theme";
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
  yAxisScale = "percent",
  animate = true,
}: {
  stepLabels: string[];
  series: FunnelChartSeries[];
  yAxisScale?: "count" | "percent";
  animate?: boolean;
}) {
  const { theme } = useAppearanceUITheme();
  const { textColor, tooltipBackgroundColor, gridLineColor } =
    getChartThemeColors(theme);

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
    const seriesConfigs = series.flatMap((s, idx) => {
      const baseColor = CHART_COLORS[idx % CHART_COLORS.length];
      const stackKey = `stack_${idx}`;
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
        })),
        type: "bar" as const,
        stack: stackKey,
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
        itemStyle: { color: hexToRgba(baseColor, 0.18) },
        // Ghost bars are decorative — don't react to hover, don't get
        // their own tooltip line. The filter in the formatter below
        // keeps them out of the table regardless.
        silent: true,
        tooltip: { show: false },
        animation: animate,
        animationDuration: animate ? 300 : 0,
      };
      return [mainSeries, ghostSeries];
    });

    return {
      tooltip: {
        appendTo: "body",
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
          const rows = items
            .map((item) => {
              const sIdx = item.data?.seriesIdx ?? 0;
              const seriesRow = series[sIdx];
              // In "percent" scale `item.value` is the normalized 0–100
              // value used for the bar height; the raw user count is
              // stashed on the data object for tooltip rendering.
              const count = item.data?.rawCount ?? item.value;
              const firstStepCount = seriesRow?.counts[0] ?? 0;
              const prevCount =
                stepIdx > 0 ? seriesRow?.counts[stepIdx - 1] : null;
              const fromStart =
                firstStepCount > 0 ? formatPct(count / firstStepCount) : "—";
              const fromPrev =
                stepIdx === 0
                  ? "—"
                  : prevCount != null && prevCount > 0
                    ? formatPct(count / prevCount)
                    : "—";
              const avgMs = seriesRow?.avgTimes[stepIdx] ?? null;
              const avgLabel = stepIdx === 0 ? "—" : formatDurationMs(avgMs);
              return `<tr><td style="${labelCell}">${item.marker}${item.seriesName}</td><td style="${numCell}"><b>${formatNumber(count)}</b></td><td style="${numCell}">${fromStart}</td><td style="${numCell}">${fromPrev}</td><td style="${numCell}">${avgLabel}</td></tr>`;
            })
            .join("");
          return `<div><div style="margin-bottom:6px"><b>${header}</b></div><table style="border-collapse:collapse;font-size:inherit"><thead><tr><th style="${headerCell}"></th><th style="${numHeaderCell}">Count</th><th style="${numHeaderCell}">From start</th><th style="${numHeaderCell}">From prev</th><th style="${numHeaderCell}">Avg time</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
        // Percent mode anchors at 0–100 (drop-off ghosts can push series
        // totals to exactly 100, so we don't need a hard max).
        min: 0,
        splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
      },
      series: seriesConfigs,
    };
  }, [
    series,
    stepLabels,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
    yAxisScale,
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
          grid: {
            left: "8%",
            right: "5%",
            top: option.legend?.show ? 52 : "8%",
            bottom: "10%",
          },
        }}
        style={{ width: "100%", height: "100%" }}
        onEvents={onEvents}
      />
    </Box>
  );
}
