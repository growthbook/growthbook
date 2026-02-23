import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type {
  ProductAnalyticsConfig,
  ProductAnalyticsResult,
} from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";

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
  valueIndex: number,
  fallback: string,
): string {
  return config?.dataset?.values?.[valueIndex]?.name ?? fallback;
}

export default function ExplorerChart({
  exploreData,
  submittedExploreState,
  loading,
  exploreError,
}: {
  exploreData: ProductAnalyticsResult | null;
  submittedExploreState: ProductAnalyticsConfig;
  loading: boolean;
  exploreError: string | null;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const gridLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const chartsContext = useDashboardCharts();

  // Transform ProductAnalyticsResult + exploreState to ECharts format
  const chartConfig = useMemo(() => {
    if (
      !exploreData?.rows?.length ||
      !submittedExploreState ||
      ["table", "timeseries-table"].includes(submittedExploreState.chartType)
    )
      return null;
    const rows = exploreData.rows;
    const chartType = submittedExploreState.chartType;
    const isHorizontalBar = chartType === "horizontalBar";

    if (chartType === "bigNumber") {
      let value = rows[0]?.values[0]?.numerator ?? 0;
      if (rows[0]?.values[0]?.denominator) {
        value /= rows[0]?.values[0]?.denominator;
      }
      return { type: "bigNumber" as const, value };
    }

    // 1. Collect all unique dates/categories (X-axis) and data points
    const uniqueXValues = new Set<string>();
    // Map structure: { "seriesKey": { "xValue": value } }
    const dataMap: Record<string, Record<string, number>> = {};
    // Track metadata for each series key to build the final series config
    const seriesMeta: Record<string, { metricId: string; name: string }> = {};

    const numMetrics = submittedExploreState?.dataset?.values?.length ?? 0;
    const numDimensions = submittedExploreState?.dimensions?.length ?? 0;

    rows.forEach((row) => {
      // First dimension is the X-axis value (Date or Category)
      const xValue = row.dimensions[0] || "";
      uniqueXValues.add(xValue);

      // Remaining dimensions form the group key
      const groupParts = row.dimensions.slice(1);
      const groupKey = groupParts.length > 0 ? groupParts.join(" - ") : "";

      row.values.forEach((v, valueIndex) => {
        // Create a unique key for this series: Value index + Group
        const seriesKey = JSON.stringify({ i: valueIndex, g: groupKey });

        if (!dataMap[seriesKey]) {
          dataMap[seriesKey] = {};

          // Construct a friendly name using the config's value name by index
          const metricName = getSeriesTitle(
            submittedExploreState,
            valueIndex,
            v.metricId,
          );
          let name: string;
          if (groupKey) {
            if (numMetrics > 1) {
              name = `${metricName} (${groupKey})`;
            } else {
              name = groupKey;
            }
          } else {
            name = metricName;
          }

          seriesMeta[seriesKey] = {
            metricId: v.metricId,
            name,
          };
        }

        dataMap[seriesKey][xValue] = v.numerator ?? 0;
        if (v.denominator) {
          dataMap[seriesKey][xValue] /= v.denominator;
        }
      });
    });

    // 2. Sort X-axis values
    const sortedXValues = Array.from(uniqueXValues).sort();

    // 3. Build Series
    const seriesColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

    const seriesConfigs = Object.keys(dataMap).map((seriesKey, idx) => {
      const { name } = seriesMeta[seriesKey];
      const seriesDataMap = dataMap[seriesKey];

      if (chartType === "bar" || chartType === "horizontalBar") {
        // Single metric + single dimension: one series with itemStyle per bar so each bar gets a different color (no grouping)
        if (numMetrics === 1 && numDimensions === 1) {
          const data = sortedXValues.map((x, i) => ({
            value: seriesDataMap[x] ?? 0,
            itemStyle: { color: seriesColor(i) },
          }));
          return { name, data, type: "bar" as const };
        }
        const data = sortedXValues.map((x) => seriesDataMap[x] ?? 0);
        return {
          name,
          data,
          color: seriesColor(idx),
          type: "bar" as const,
        };
      }

      if (chartType === "line" || chartType === "area") {
        const data = sortedXValues.map((x) => [
          new Date(x).getTime(),
          seriesDataMap[x] ?? 0,
        ]);
        const lineConfig = {
          name,
          data,
          color: seriesColor(idx),
          type: "line" as const,
          animation: true,
          animationDuration: 300,
          animationEasing: "linear" as const,
          symbol: "circle" as const,
          symbolSize: 4,
        };
        if (chartType === "line") return lineConfig;
        if (chartType === "area")
          return { ...lineConfig, areaStyle: {}, stack: "stack" };
      }
    });

    // Define the category axis (shows the dimension labels)
    const categoryAxis = {
      type: chartType === "line" || chartType === "area" ? "time" : "category",
      data: sortedXValues,
      nameLocation: "middle" as const,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [10, 0],
        color: textColor,
      },
      axisLabel: {
        color: textColor,
        rotate: isHorizontalBar ? 0 : -45,
        hideOverlap: true,
      },
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Define the value axis (shows the numeric values)
    const valueAxis = {
      type: "value" as const,
      scale: false,
      nameLocation: "middle" as const,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [40, 0],
        color: textColor,
      },
      axisLabel: { color: textColor, formatter: formatNumber },
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Swap axes for horizontal bar
    const xAxis = isHorizontalBar ? valueAxis : categoryAxis;
    const yAxis = isHorizontalBar ? categoryAxis : valueAxis;

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        padding: [10, 14],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: {
          type:
            chartType === "bar" || chartType === "horizontalBar"
              ? "shadow"
              : "cross",
        },
      },
      legend: {
        show: seriesConfigs.length > 1,
        top: 16,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
      },
      xAxis,
      yAxis,
      series: seriesConfigs,
    };
  }, [
    exploreData?.rows,
    submittedExploreState,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
  ]);

  const hasEmptyData = useMemo(() => {
    if (!exploreData?.rows?.length) return true;
    return exploreData.rows.every((r) => r.values.length === 0);
  }, [exploreData]);

  // Don't early-return when loading: we need to show the spinner during refetch after error
  if (!loading && exploreData?.sql && exploreData?.error) return null;

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
          <LoadingSpinner style={{ width: "12px", height: "12px" }} />
        </Flex>
      ) : exploreError ? (
        <Box p="4">
          <Callout status="error">{exploreError}</Callout>
        </Box>
      ) : !exploreData ? (
        <Flex
          p="4"
          style={{ textAlign: "center" }}
          align="center"
          justify="center"
          minHeight="500px"
        >
          <Text color="text-mid" weight="medium">
            No data available. Select a metric to see results.
          </Text>
        </Flex>
      ) : hasEmptyData ? (
        <Flex
          p="4"
          style={{ textAlign: "center" }}
          minHeight="500px"
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            The query ran successfully, but no data was returned.
          </Text>
        </Flex>
      ) : chartConfig?.type === "bigNumber" ? (
        <Flex p="4" minHeight="500px" align="center" justify="center">
          <BigValueChart
            value={chartConfig.value}
            formatter={formatNumber}
            label={submittedExploreState?.dataset?.values?.[0]?.name}
          />
        </Flex>
      ) : ["table", "timeseries-table"].includes(
          submittedExploreState?.chartType,
        ) ? null : chartConfig ? (
        <EChartsReact
          key={JSON.stringify(chartConfig)}
          option={{
            ...chartConfig,
            padding: [0, 0, 0, 0],
            grid: {
              left:
                submittedExploreState?.chartType === "horizontalBar"
                  ? "10%"
                  : "8%",
              right: "5%",
              top: chartConfig.legend?.show ? "13%" : "10%",
              bottom: "10%",
            },
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
