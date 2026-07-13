import { useMemo, useState } from "react";
import {
  DashboardBlockInterfaceOrData,
  ExperimentsStatusBlockInterface,
  getDateGranularity,
} from "shared/enterprise";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import {
  ResolvedGranularity,
  formatDateByGranularity,
} from "@/enterprise/components/ProductAnalytics/util";
import ComparisonChartLegend from "@/enterprise/components/ProductAnalytics/ComparisonChartLegend";
import { CompareChartLegendItem } from "@/enterprise/components/ProductAnalytics/comparison-chart";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";
import {
  VELOCITY_RESULT_KEYS,
  VelocityBucket,
  VelocityResultKey,
  bucketVelocity,
  rangeLabel,
} from "./completedExperimentsData";
import { useCompletedExperimentsComparison } from "./completedExperiments";

// Pulled from the Metric Explorer chart palette (CHART_COLORS in
// ProductAnalytics/MainSection/ExplorerChart.tsx) so the dashboard's ECharts
// blocks share one color scheme. Mapped to the semantically matching hues.
const RESULT_COLORS: Record<VelocityResultKey, string> = {
  won: "#22c55e", // green
  lost: "#ef4444", // red
  inconclusive: "#6b7280", // gray
  dnf: "#eab308", // yellow
};

// Capitalized display labels for the legend + tooltip.
const RESULT_LABELS: Record<VelocityResultKey, string> = {
  won: "Won",
  lost: "Lost",
  inconclusive: "Inconclusive",
  dnf: "DNF",
};

// ECharts series names. The previous-period series get a distinct suffix so the
// legend can toggle current vs previous independently.
const currentSeriesName = (key: VelocityResultKey) => RESULT_LABELS[key];
const previousSeriesName = (key: VelocityResultKey) =>
  `${RESULT_LABELS[key]} (previous)`;

function fadedColor(hex: string, alpha = 0.4): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Tooltip markup, matched to the Metric Explorer compare tooltip -----------
// (ProductAnalytics/comparison-chart.ts). Kept local so the split-off block
// doesn't depend on the exploration-specific tooltip formatter.

// 11px rounded-square swatch, same as compareTooltipMarker's "bar" style.
function tooltipMarker(color: string): string {
  return `<span style="display:inline-block;width:11px;height:11px;border-radius:2px;background-color:${color};margin-right:8px;vertical-align:middle"></span>`;
}

// A right-aligned "Current" / "Previous" row inside a category block.
function periodRow(
  color: string,
  label: string,
  value: number,
  isPrevious: boolean,
): string {
  const labelStyle = isPrevious ? "opacity:0.6" : "";
  const valueStyle = isPrevious ? "opacity:0.6" : "font-weight:700";
  const markerColor = isPrevious ? fadedColor(color) : color;
  return (
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-top:3px">` +
    `<span style="display:flex;align-items:center">${tooltipMarker(
      markerColor,
    )}<span style="${labelStyle}">${label}</span></span>` +
    `<span style="${valueStyle}">${value}</span>` +
    `</div>`
  );
}

// A single flat row (no current/previous split) used when comparison is off.
function neutralRow(color: string, name: string, value: number): string {
  return (
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-top:3px">` +
    `<span>${tooltipMarker(color)}${name}</span>` +
    `<span style="font-weight:700">${value}</span>` +
    `</div>`
  );
}

function buildVelocityTooltip({
  index,
  currentBuckets,
  previousBuckets,
  tooltipLabels,
  prevTooltipLabels,
  comparisonEnabled,
}: {
  index: number;
  currentBuckets: { [k in VelocityResultKey]: number }[];
  previousBuckets: ({ [k in VelocityResultKey]: number } | null)[];
  tooltipLabels: string[];
  prevTooltipLabels: string[];
  comparisonEnabled: boolean;
}): string {
  const cur = currentBuckets[index];
  const prev = previousBuckets[index];

  let html = `<div style="font-weight:600">${tooltipLabels[index] ?? ""}</div>`;
  if (comparisonEnabled && prevTooltipLabels[index]) {
    html += `<div style="font-size:12px;opacity:0.6">Compared with ${prevTooltipLabels[index]}</div>`;
  }

  VELOCITY_RESULT_KEYS.forEach((key) => {
    const color = RESULT_COLORS[key];
    if (comparisonEnabled) {
      html +=
        `<div style="margin-top:8px">` +
        `<div style="font-weight:600">${RESULT_LABELS[key]}</div>` +
        periodRow(color, "Current", cur ? cur[key] : 0, false) +
        periodRow(color, "Previous", prev ? prev[key] : 0, true) +
        `</div>`;
    } else {
      html += neutralRow(color, RESULT_LABELS[key], cur ? cur[key] : 0);
    }
  });

  return html;
}

// Compact x-axis tick label, e.g. "Dec '25" (month) or "Sep 14, '25" (day/week).
// The verbose label (formatDateByGranularity) is reserved for the tooltip.
function compactBucketLabel(
  date: Date,
  granularity: ResolvedGranularity,
): string {
  switch (granularity) {
    case "year":
      return date.toLocaleDateString(undefined, { year: "numeric" });
    case "month":
      return date.toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
      });
    case "hour":
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
      });
    case "week":
    case "day":
    default:
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "2-digit",
      });
  }
}

// Simple centered legend used when comparison is off.
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Flex align="center" gap="1">
      <span
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: color,
        }}
      />
      <Text size="small">{label}</Text>
    </Flex>
  );
}

export default function VelocityBlockChart({
  block,
  chartId,
}: {
  block: DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>;
  chartId: string;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const chartsContext = useDashboardCharts();

  // Which ECharts series are toggled off via the legend.
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const toggleSeries = (names: string[]) =>
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      const anyVisible = names.some((n) => !next.has(n));
      names.forEach((n) => (anyVisible ? next.add(n) : next.delete(n)));
      return next;
    });

  const { current, previous, loading, window, previousWindow } =
    useCompletedExperimentsComparison(block);
  // Team Velocity does not support period comparison — always render the
  // single-period view, even if an older block still has comparison persisted.
  const comparisonEnabled = false;

  const option = useMemo(() => {
    const resolvedGranularity: ResolvedGranularity = getDateGranularity(
      block.dateGranularity || "auto",
      { startDate: window.startDate, endDate: window.endDate },
    );

    const currentBuckets = bucketVelocity(current, window, resolvedGranularity);
    const rawPreviousBuckets = comparisonEnabled
      ? bucketVelocity(previous, previousWindow, resolvedGranularity)
      : [];
    // Align previous buckets to the current window by ordinal offset from each
    // window's start. The shifted window can produce a different bucket count
    // (e.g. month granularity spanning an extra month boundary), so truncate
    // extras and pad missing slots with null so lengths always match the
    // current window's buckets (null renders as zero counts / no compare row).
    const previousBuckets: (VelocityBucket | null)[] = currentBuckets.map(
      (_, i) => rawPreviousBuckets[i] ?? null,
    );

    // Compact labels on the axis; verbose labels (e.g. "December 2025") only in
    // the tooltip so ticks stay readable.
    const categories = currentBuckets.map((b) =>
      compactBucketLabel(b.date, resolvedGranularity),
    );
    const tooltipLabels = currentBuckets.map((b) =>
      formatDateByGranularity(b.date, resolvedGranularity),
    );
    const prevTooltipLabels = previousBuckets.map((b) =>
      b ? formatDateByGranularity(b.date, resolvedGranularity) : "",
    );

    // previousBuckets is already aligned 1:1 with the current buckets; padded
    // (null) slots contribute zero counts.
    const prevAligned = (key: VelocityResultKey) =>
      previousBuckets.map((b) => b?.[key] ?? 0);

    const currentSeries = VELOCITY_RESULT_KEYS.filter(
      (key) => !hiddenSeries.has(currentSeriesName(key)),
    ).map((key) => ({
      name: currentSeriesName(key),
      type: "bar" as const,
      stack: "current",
      xAxisIndex: 0,
      barWidth: comparisonEnabled ? "45%" : "60%",
      z: 3,
      itemStyle: { color: RESULT_COLORS[key] },
      data: currentBuckets.map((b) => b[key]),
    }));

    // Previous period: a second stacked bar overlaid behind the current one on a
    // hidden twin axis so it stays centered (mirrors the Product Analytics bar
    // compare). Muted so the current period reads as primary.
    const previousSeries = comparisonEnabled
      ? VELOCITY_RESULT_KEYS.filter(
          (key) => !hiddenSeries.has(previousSeriesName(key)),
        ).map((key) => ({
          name: previousSeriesName(key),
          type: "bar" as const,
          stack: "previous",
          xAxisIndex: 1,
          barGap: "-100%",
          barWidth: "62%",
          z: 1,
          itemStyle: { color: fadedColor(RESULT_COLORS[key]) },
          data: prevAligned(key),
        }))
      : [];

    const baseCategoryAxis = {
      type: "category" as const,
      data: categories,
      axisLabel: {
        color: textColor,
        rotate: -45,
        hideOverlap: true,
      },
    };

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) =>
          buildVelocityTooltip({
            index: params?.[0]?.dataIndex ?? 0,
            currentBuckets,
            previousBuckets,
            tooltipLabels,
            prevTooltipLabels,
            comparisonEnabled,
          }),
      },
      // Legend is rendered in React (ComparisonChartLegend in compare mode) so
      // it can carry the period context; disable the built-in one.
      legend: { show: false },
      grid: { left: 40, right: 16, top: 12, bottom: 56 },
      xAxis: comparisonEnabled
        ? [
            baseCategoryAxis,
            {
              ...baseCategoryAxis,
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: { show: false },
              axisPointer: { label: { show: false } },
            },
          ]
        : baseCategoryAxis,
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: textColor },
      },
      ...(comparisonEnabled
        ? { axisPointer: { link: [{ xAxisIndex: "all" }] } }
        : {}),
      series: [...currentSeries, ...previousSeries],
    };
  }, [
    block.dateGranularity,
    current,
    previous,
    window,
    previousWindow,
    comparisonEnabled,
    hiddenSeries,
    textColor,
  ]);

  const legendItems: CompareChartLegendItem[] = VELOCITY_RESULT_KEYS.map(
    (key) => ({
      baseName: RESULT_LABELS[key],
      currentColor: RESULT_COLORS[key],
      previousColor: fadedColor(RESULT_COLORS[key]),
      currentSeriesName: currentSeriesName(key),
      previousSeriesName: previousSeriesName(key),
    }),
  );

  if (loading) return <LoadingSpinner />;

  return (
    <Flex
      direction="column"
      gap="2"
      style={{ width: "100%", height: "100%", minHeight: 260 }}
    >
      {comparisonEnabled ? (
        <ComparisonChartLegend
          currentLabel={rangeLabel(window)}
          previousLabel={rangeLabel(previousWindow)}
          items={legendItems}
          hiddenSeries={hiddenSeries}
          onToggleSeries={toggleSeries}
          textColor={textColor}
        />
      ) : (
        <Flex justify="center" gap="4" wrap="wrap">
          {VELOCITY_RESULT_KEYS.map((key) => (
            <LegendDot
              key={key}
              color={RESULT_COLORS[key]}
              label={RESULT_LABELS[key]}
            />
          ))}
        </Flex>
      )}
      <Box style={{ flex: 1, width: "100%", minHeight: 200 }}>
        <EChartsReact
          key={comparisonEnabled ? "compare" : "single"}
          option={option}
          notMerge
          style={{ width: "100%", height: "100%", minHeight: 200 }}
          onChartReady={(chart) => {
            if (chartsContext && chart) {
              chartsContext.registerChart(chartId, chart);
            }
          }}
        />
      </Box>
    </Flex>
  );
}
