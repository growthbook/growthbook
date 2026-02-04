import { useMemo } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type { ProductAnalyticsConfig } from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import { useExplorerContext } from "../ExplorerContext";

const CHART_ID = "explorer-chart";

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

// Simple number formatter
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

    if (chartType === "bigNumber") {
      const value = rows[0]?.values[0]?.numerator ?? 0;
      return { type: "bigNumber" as const, value };
    }

    // 1. Collect all unique dates/categories (X-axis) and data points
    const uniqueXValues = new Set<string>();
    // Map structure: { "seriesKey": { "xValue": value } }
    const dataMap: Record<string, Record<string, number>> = {};
    // Track metadata for each series key to build the final series config
    const seriesMeta: Record<string, { metricId: string; name: string }> = {};

    rows.forEach((row) => {
      // First dimension is the X-axis value (Date or Category)
      const xValue = row.dimensions[0] || "";
      uniqueXValues.add(xValue);

      // Remaining dimensions form the group key
      const groupParts = row.dimensions.slice(1);
      const groupKey = groupParts.length > 0 ? groupParts.join(" - ") : "";

      row.values.forEach((v) => {
        // Create a unique key for this series: Metric + Group
        const seriesKey = JSON.stringify({ m: v.metricId, g: groupKey });

        if (!dataMap[seriesKey]) {
          dataMap[seriesKey] = {};

          // Construct a friendly name
          const metricName = getSeriesTitle(submittedExploreState, v.metricId);
          const name = groupKey ? `${metricName} (${groupKey})` : metricName;

          seriesMeta[seriesKey] = {
            metricId: v.metricId,
            name,
          };
        }

        dataMap[seriesKey][xValue] = v.numerator ?? 0;
      });
    });

    // 2. Sort X-axis values
    const sortedXValues = Array.from(uniqueXValues).sort();

    // 3. Build Series
    const seriesConfigs = Object.keys(dataMap).map((seriesKey, idx) => {
      const { name } = seriesMeta[seriesKey];
      const seriesDataMap = dataMap[seriesKey];

      // Map values to the sorted X-axis, filling gaps with 0
      const data = sortedXValues.map((x) => seriesDataMap[x] ?? 0);

      const commonSeriesConfig = {
        name,
        data,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      };

      if (chartType === "bar") {
        return {
          ...commonSeriesConfig,
          type: "bar",
        };
      }

      // Line chart
      return {
        ...commonSeriesConfig,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
      };
    });

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: { type: chartType === "bar" ? "shadow" : "cross" },
      },
      legend: {
        show: seriesConfigs.length > 1,
        top: chartType === "line" ? 16 : 0,
        textStyle: { color: textColor },
        type: "scroll",
      },
      xAxis: {
        type: "category",
        data: sortedXValues,
        nameLocation: "middle",
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
      series: seriesConfigs,
    };
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
        <Flex justify="center" align="center" height="500px">
          <LoadingOverlay text="Loading data..." />
        </Flex>
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
