import { useMemo } from "react";
import { Box, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type { ProductAnalyticsConfig } from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import { useExplorerContext } from "../ExplorerContext";

const CHART_ID = "explorer-chart";

const FALLBACK_COLORS = [
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

// Simple number formatter
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getSeriesColor(
  config: ProductAnalyticsConfig | null,
  metricId: string,
  index: number,
): string {
  const value = config?.dataset?.values?.find(
    (v) => (v.type === "metric" && v.metricId === metricId) || v.name === metricId,
  );
  if (value?.color) return value.color;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function getSeriesTitle(
  config: ProductAnalyticsConfig | null,
  metricId: string,
): string {
  const value = config?.dataset?.values?.find(
    (v) => (v.type === "metric" && v.metricId === metricId) || v.name === metricId,
  );
  return value?.name ?? metricId;
}

export default function ExplorerChart() {
  const { exploreData, submittedExploreState, loading } = useExplorerContext();
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const chartsContext = useDashboardCharts();

  // Transform ProductAnalyticsResult + exploreState to ECharts format
  const chartConfig = useMemo(() => {
    if (!exploreData?.rows?.length || !submittedExploreState) return null;
    const rows = exploreData.rows;
    const chartType = submittedExploreState.chartType;

    // Big number: single row with single (or first) value
    if (rows.length === 1 && rows[0].values.length >= 1) {
      const singleRow = rows[0];
      if (singleRow.dimensions[0] === "_total" || singleRow.values.length === 1) {
        const value = singleRow.values[0]?.value ?? 0;
        return { type: "bigNumber" as const, value };
      }
    }

    // Collect unique metricIds in order (from first row)
    const metricIds =
      rows[0]?.values.map((v) => v.metricId) ?? [];
    const numSeries = metricIds.length;

    // Bar chart: x = dimensions[0] per row, one series per metricId
    if (chartType === "bar") {
      const source: (string | number)[][] = [
        ["dim", ...metricIds],
        ...rows.map((r) => [
          r.dimensions[0] ?? "",
          ...metricIds.map((id) => r.values.find((v) => v.metricId === id)?.value ?? 0),
        ]),
      ];
      const seriesConfigs = metricIds.map((metricId, idx) => ({
        name: getSeriesTitle(submittedExploreState, metricId),
        type: "bar",
        encode: { x: "dim", y: metricId },
        color: getSeriesColor(submittedExploreState, metricId, idx),
      }));
      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: { type: "shadow" },
        },
        legend: {
          show: numSeries > 1,
          top: 0,
          textStyle: { color: textColor },
        },
        xAxis: {
          type: "category",
          nameLocation: "middle",
          scale: false,
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [10, 0],
            color: textColor,
          },
          axisLabel: {
            color: textColor,
            rotate: -45,
            hideOverlap: true,
            interval: 0,
          },
        },
        yAxis: {
          type: "value",
          scale: false,
          nameLocation: "middle",
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [40, 0],
            color: textColor,
          },
          axisLabel: { color: textColor, formatter: formatNumber },
        },
        dataset: [{ source }],
        series: seriesConfigs,
      };
    }

    // Line / area: x = dimensions[0] (date), one series per metricId
    if (chartType === "line" || chartType === "area") {
      const source: (string | number)[][] = [
        ["date", ...metricIds],
        ...rows.map((r) => [
          r.dimensions[0] ?? "",
          ...metricIds.map((id) => r.values.find((v) => v.metricId === id)?.value ?? 0),
        ]),
      ];
      const seriesConfigs = metricIds.map((metricId, idx) => ({
        name: getSeriesTitle(submittedExploreState, metricId),
        type: chartType === "area" ? "line" : "line",
        areaStyle: chartType === "area" ? {} : undefined,
        encode: { x: "date", y: metricId },
        color: getSeriesColor(submittedExploreState, metricId, idx),
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
      }));
      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: { type: "cross" },
        },
        legend: {
          show: numSeries > 1,
          top: 16,
          textStyle: { color: textColor },
          type: "scroll",
        },
        xAxis: {
          type: "time",
          nameLocation: "middle",
          scale: false,
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [10, 0],
            color: textColor,
          },
          axisLabel: { color: textColor, rotate: -45, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          scale: false,
          nameLocation: "middle",
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [40, 0],
            color: textColor,
          },
          axisLabel: { color: textColor, formatter: formatNumber },
        },
        dataset: [{ source }],
        series: seriesConfigs,
      };
    }

    return null;
  }, [exploreData, submittedExploreState, textColor]);

  const hasEmptyData = useMemo(() => {
    if (!exploreData?.rows?.length) return true;
    return exploreData.rows.every((r) => r.values.length === 0);
  }, [exploreData]);

  return (
    <Box
      position="relative"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
      }}
    >
      {loading ? (
        <LoadingOverlay />
      ) : !exploreData ? (
        <Box p="4" style={{ textAlign: "center" }}>
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            No data available. Select a metric to see results.
          </Text>
        </Box>
      ) : hasEmptyData ? (
        <Box p="4" style={{ textAlign: "center" }}>
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            The query ran successfully, but no data was returned.
          </Text>
        </Box>
      ) : chartConfig?.type === "bigNumber" ? (
        <BigValueChart value={chartConfig.value} formatter={formatNumber} />
      ) : chartConfig ? (
        <EChartsReact
          key={JSON.stringify(chartConfig)}
          option={{
            ...chartConfig,
            padding: [0, 0, 0, 0],
            grid: { left: "6%", right: "5%", top: "10%", bottom: "10%" },
          }}
          style={{ width: "100%", minHeight: "500px" }}
          onChartReady={(chart) => {
            if (chartsContext && chart) {
              chartsContext.registerChart(CHART_ID, chart);
            }
          }}
        />
      ) : (
        <Box p="4" style={{ textAlign: "center" }}>
          <HelperText status="error">Unknown chart type</HelperText>
        </Box>
      )}
    </Box>
  );
}
