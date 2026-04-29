import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  shouldChartSectionShow,
  getEffectiveMetricValue,
  computeDimensionTotals,
  getIsRatioByIndex,
  getEffectiveShowAs,
  getSharedUnit,
  showAsAppliesTo,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
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
  config: ExplorationConfig | null,
  valueIndex: number,
  fallback: string,
): string {
  return config?.dataset?.values?.[valueIndex]?.name ?? fallback;
}

export default function ExplorerChart({
  exploration,
  error,
  submittedExploreState,
  loading,
  animate = true,
}: {
  exploration: ProductAnalyticsExploration | null;
  error: string | null;
  submittedExploreState: ExplorationConfig;
  loading: boolean;
  /** When false, ECharts entry animations are disabled (e.g. for already-seen charts). */
  animate?: boolean;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const gridLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const chartsContext = useDashboardCharts();
  const { getFactMetricById } = useDefinitions();

  const renderOpts: RenderOpts = useMemo(
    () => ({
      showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
      isRatioByIndex: getIsRatioByIndex(
        submittedExploreState,
        getFactMetricById,
      ),
    }),
    [submittedExploreState, getFactMetricById],
  );

  // Y-axis label: reflects whether we're rendering raw totals or per-unit
  // averages. Only populated when showAs applies (otherwise the toggle is
  // hidden and the number's meaning is carried by the metric/series name).
  const valueAxisName = useMemo(() => {
    if (!showAsAppliesTo(submittedExploreState, getFactMetricById)) return "";
    if (renderOpts.showAs === "total") return "Total";
    const sharedUnit = getSharedUnit(submittedExploreState);
    return sharedUnit ? `Per ${sharedUnit}` : "Per unit";
  }, [submittedExploreState, getFactMetricById, renderOpts.showAs]);

  // Transform ProductAnalyticsResult + exploreState to ECharts format
  const chartConfig = useMemo(() => {
    if (
      !exploration?.result?.rows?.length ||
      !submittedExploreState ||
      ["table", "timeseries-table"].includes(submittedExploreState.chartType)
    )
      return null;
    const rows = exploration.result.rows;
    const chartType = submittedExploreState.chartType;
    const isHorizontalBar =
      chartType === "horizontalBar" || chartType === "stackedHorizontalBar";
    const isStacked =
      chartType === "stackedBar" || chartType === "stackedHorizontalBar";

    if (chartType === "bigNumber") {
      const firstValue = rows[0]?.values[0];
      const value = firstValue
        ? getEffectiveMetricValue(firstValue, {
            showAs: renderOpts.showAs,
            isRatio: renderOpts.isRatioByIndex[0] ?? false,
          })
        : 0;
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

        dataMap[seriesKey][xValue] = getEffectiveMetricValue(v, {
          showAs: renderOpts.showAs,
          isRatio: renderOpts.isRatioByIndex[valueIndex] ?? false,
        });
      });
    });

    // 2. Compute cumulative totals for sorting
    const seriesTotals: Record<string, number> = {};
    for (const [seriesKey, seriesData] of Object.entries(dataMap)) {
      seriesTotals[seriesKey] = Object.values(seriesData).reduce(
        (sum, v) => sum + v,
        0,
      );
    }
    const sortedSeriesKeys = Object.keys(dataMap).sort(
      (a, b) => seriesTotals[b] - seriesTotals[a],
    );

    const isBarType = [
      "bar",
      "stackedBar",
      "stackedHorizontalBar",
      "horizontalBar",
    ].includes(chartType);

    // Bar charts: sort categories by total value; timeseries: chronological
    let sortedXValues: string[];
    if (isBarType) {
      const xValueTotals = computeDimensionTotals(rows, 0, renderOpts);
      // Horizontal bars render bottom-to-top, so sort ascending for largest on top
      sortedXValues = Array.from(uniqueXValues).sort((a, b) =>
        isHorizontalBar
          ? xValueTotals[a] - xValueTotals[b]
          : xValueTotals[b] - xValueTotals[a],
      );
    } else {
      sortedXValues = Array.from(uniqueXValues).sort();
    }

    // 3. Build Series (ordered by cumulative total, highest first)
    const seriesColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

    const seriesConfigs = sortedSeriesKeys.map((seriesKey, idx) => {
      const { name } = seriesMeta[seriesKey];
      const seriesDataMap = dataMap[seriesKey];

      if (
        ["bar", "stackedBar", "stackedHorizontalBar", "horizontalBar"].includes(
          chartType,
        )
      ) {
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
          stack: isStacked ? "stack" : undefined,
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
          animation: animate,
          animationDuration: animate ? 300 : 0,
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
      name: valueAxisName,
      nameLocation: "middle" as const,
      nameGap: 50,
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
          type: [
            "bar",
            "stackedBar",
            "stackedHorizontalBar",
            "horizontalBar",
          ].includes(chartType)
            ? "shadow"
            : "cross",
        },
      },
      legend: {
        show: seriesConfigs.length > 1,
        top: 8,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
      },
      xAxis,
      yAxis,
      series: seriesConfigs,
    };
  }, [
    exploration?.result?.rows,
    submittedExploreState,
    renderOpts,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
    valueAxisName,
  ]);

  const hasEmptyData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

  if (
    !shouldChartSectionShow({
      loading,
      error,
      submittedExploreState,
    })
  )
    return null;

  return (
    <Flex
      direction="column"
      position="relative"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        flex: 1,
        minHeight: 0,
      }}
    >
      {error ? (
        <Box p="4">
          <Callout status="error">{error}</Callout>
        </Box>
      ) : !exploration ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            No data available. Select a metric to see results.
          </Text>
        </Flex>
      ) : hasEmptyData ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            The query ran successfully, but no data was returned.
          </Text>
        </Flex>
      ) : chartConfig?.type === "bigNumber" ? (
        <Flex
          p="4"
          style={{ flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <BigValueChart
            value={chartConfig.value}
            formatter={formatNumber}
            label={submittedExploreState?.dataset?.values?.[0]?.name}
          />
        </Flex>
      ) : chartConfig ? (
        <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <EChartsReact
            key={JSON.stringify(chartConfig)}
            option={{
              ...chartConfig,
              ...(animate ? {} : { animation: false }),
              padding: [0, 0, 0, 0],
              grid: {
                left:
                  submittedExploreState?.chartType === "horizontalBar" ||
                  submittedExploreState?.chartType === "stackedHorizontalBar"
                    ? "10%"
                    : "8%",
                right: "5%",
                top: chartConfig.legend?.show ? 52 : "8%",
                bottom: "10%",
              },
            }}
            style={{ width: "100%", height: "100%" }}
            onChartReady={(chart) => {
              if (chartsContext && chart) {
                chartsContext.registerChart(CHART_ID, chart);
              }
            }}
          />
        </Box>
      ) : (
        <Box p="4" style={{ textAlign: "center" }}>
          <HelperText status="error">Unknown chart type</HelperText>
        </Box>
      )}
    </Flex>
  );
}
