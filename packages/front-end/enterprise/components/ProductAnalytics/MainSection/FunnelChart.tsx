import React, { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { formatDurationMs } from "@/enterprise/components/ProductAnalytics/util";
import Text from "@/ui/Text";

const CHART_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#6b7280",
];

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

interface DimensionSeries {
  /** Dimension value (or "" when no dimension). */
  key: string;
  /** Label shown in the legend/x-axis. */
  label: string;
  /** Counts per step in step order. */
  counts: number[];
  /** Avg time-from-previous-step in ms per step (null for step 0 / no data). */
  avgTimes: (number | null)[];
}

export default function FunnelChart({
  exploration,
  submittedExploreState,
  animate = true,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
  animate?: boolean;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const gridLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";

  const stepNames = useMemo(() => {
    if (submittedExploreState.dataset.type !== "funnel") return [];
    return submittedExploreState.dataset.steps.map((s) => s.name);
  }, [submittedExploreState]);

  const dimensionSeries: DimensionSeries[] = useMemo(() => {
    const rows = exploration?.result?.rows ?? [];
    if (!rows.length || !stepNames.length) return [];
    const series: DimensionSeries[] = [];
    rows.forEach((row) => {
      const steps = row.steps ?? [];
      const key = row.dimensions[0] ?? "";
      const counts = stepNames.map((_, i) => steps[i]?.count ?? 0);
      const avgTimes = stepNames.map((_, i) => {
        const s = steps[i];
        if (!s || !s.timeFromPrevSumMs || !s.count) return null;
        return s.timeFromPrevSumMs / s.count;
      });
      series.push({
        key,
        label: key || "All users",
        counts,
        avgTimes,
      });
    });
    return series;
  }, [exploration?.result?.rows, stepNames]);

  const sortedSeries = useMemo(() => {
    // Sort by first-step count descending so the biggest funnel shows up first.
    return [...dimensionSeries].sort(
      (a, b) => (b.counts[0] ?? 0) - (a.counts[0] ?? 0),
    );
  }, [dimensionSeries]);

  const option = useMemo(() => {
    if (!sortedSeries.length || !stepNames.length) return null;

    const seriesConfigs = sortedSeries.map((s, idx) => ({
      name: s.label,
      data: s.counts.map((count, stepIdx) => ({
        value: count,
        stepIdx,
        seriesIdx: idx,
      })),
      type: "bar" as const,
      color: CHART_COLORS[idx % CHART_COLORS.length],
      animation: animate,
      animationDuration: animate ? 300 : 0,
    }));

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        padding: [10, 14],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as {
            seriesName: string;
            marker: string;
            value: number;
            dataIndex: number;
            data?: { stepIdx?: number; seriesIdx?: number };
          }[];
          if (!items.length) return "";
          const stepIdx = items[0].dataIndex;
          const header = stepNames[stepIdx] ?? `Step ${stepIdx + 1}`;
          const rows = items
            .map((item) => {
              const sIdx = item.data?.seriesIdx ?? 0;
              const series = sortedSeries[sIdx];
              const count = item.value;
              const firstStepCount = series?.counts[0] ?? 0;
              const prevCount =
                stepIdx > 0 ? series?.counts[stepIdx - 1] : null;
              const fromStart =
                firstStepCount > 0 ? formatPct(count / firstStepCount) : "—";
              const fromPrev =
                prevCount != null && prevCount > 0
                  ? formatPct(count / prevCount)
                  : "—";
              const avgMs = series?.avgTimes[stepIdx] ?? null;
              const avgLabel =
                stepIdx === 0
                  ? ""
                  : `Avg time: ${formatDurationMs(avgMs)}<br/>`;
              return `<div style="margin-top:4px"><b>${item.marker}${item.seriesName}</b><br/>Count: <b>${formatNumber(count)}</b><br/>From start: ${fromStart}<br/>From prev: ${fromPrev}<br/>${avgLabel}</div>`;
            })
            .join("");
          return `<div><div style="margin-bottom:4px"><b>${header}</b></div>${rows}</div>`;
        },
      },
      legend: {
        show: sortedSeries.length > 1,
        top: 8,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
      },
      xAxis: {
        type: "category",
        data: stepNames,
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, formatter: formatNumber },
        splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
      },
      series: seriesConfigs,
    };
  }, [
    sortedSeries,
    stepNames,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
  ]);

  if (!exploration || !stepNames.length) {
    return (
      <Flex
        p="4"
        style={{ flex: 1, minHeight: 0 }}
        align="center"
        justify="center"
      >
        <Text color="text-mid" weight="medium">
          Configure at least two funnel steps to see results.
        </Text>
      </Flex>
    );
  }

  if (!option) {
    return (
      <Flex
        p="4"
        style={{ flex: 1, minHeight: 0 }}
        align="center"
        justify="center"
      >
        <Text color="text-mid" weight="medium">
          The query ran successfully, but no data was returned.
        </Text>
      </Flex>
    );
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <EChartsReact
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
      />
    </Box>
  );
}
