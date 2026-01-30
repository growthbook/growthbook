import { useMemo } from "react";
import { Box, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import {
  ExploreSeries,
  ExploreQueryResponse,
  ExploreLineChartSeries,
  ExploreBarChartSeries,
} from "shared/enterprise";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";

interface ExplorerChartProps {
  series: ExploreSeries[];
  data: ExploreQueryResponse | null;
  loading?: boolean;
  chartId?: string;
}

// Simple number formatter
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ExplorerChart({
  series,
  data,
  loading = false,
  chartId = "explorer-chart",
}: ExplorerChartProps) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const chartsContext = useDashboardCharts();

  // Get series color by ID, with fallback
  const getSeriesColor = (seriesId: string, index: number): string => {
    const seriesItem = series.find((s) => s.id === seriesId);
    if (seriesItem?.color) return seriesItem.color;
    // Fallback colors
    const COLORS = [
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
    return COLORS[index % COLORS.length];
  };

  // Get series title by ID
  const getSeriesTitle = (seriesId: string): string => {
    const seriesItem = series.find((s) => s.id === seriesId);
    return seriesItem?.name || `Series ${seriesId}`;
  };

  // Transform API response to ECharts format
  const chartConfig = useMemo(() => {
    if (!data) return null;

    // Big Number visualization
    if (data.type === "bigNumber") {
      return {
        type: "bigNumber" as const,
        value: data.data.value,
      };
    }

    // Bar chart visualization
    if (data.type === "bar") {
      const datasets: { source: { x: string; y: number }[] }[] = [];
      const seriesConfigs: object[] = [];

      data.series.forEach((barSeries: ExploreBarChartSeries, idx) => {
        const chartData = barSeries.groups.map((g) => ({
          x: g.group,
          y: g.amount,
        }));

        datasets.push({ source: chartData });
        seriesConfigs.push({
          name: barSeries.title || getSeriesTitle(barSeries.id),
          type: "bar",
          datasetIndex: idx,
          encode: { x: "x", y: "y" },
          color: getSeriesColor(barSeries.id, idx),
        });
      });

      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: { type: "shadow" },
        },
        legend: {
          show: data.series.length > 1,
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
        dataset: datasets,
        series: seriesConfigs,
      };
    }

    // Line chart (timeseries) visualization
    if (data.type === "linechart") {
      const datasets: { source: { x: Date; y: number }[] }[] = [];
      const seriesConfigs: object[] = [];

      data.series.forEach((lineSeries: ExploreLineChartSeries, idx) => {
        // Handle grouped line chart (when groupBy is used)
        if (lineSeries.groups) {
          lineSeries.groups.forEach((group, groupIdx) => {
            const chartData = group.dates.map((d) => ({
              x: new Date(d.date),
              y: d.numerator ?? d.mean * d.units,
            }));

            datasets.push({ source: chartData });
            seriesConfigs.push({
              name: `${lineSeries.title || getSeriesTitle(lineSeries.id)} - ${group.group}`,
              type: "line",
              datasetIndex: datasets.length - 1,
              encode: { x: "x", y: "y" },
              color: getSeriesColor(lineSeries.id, groupIdx),
              smooth: true,
              symbol: "circle",
              symbolSize: 4,
            });
          });
        } else if (lineSeries.data) {
          // Simple time series (no grouping)
          const chartData = lineSeries.data.map((d) => ({
            x: new Date(d.date),
            y: d.numerator ?? d.mean * d.units,
          }));

          datasets.push({ source: chartData });
          seriesConfigs.push({
            name: lineSeries.title || getSeriesTitle(lineSeries.id),
            type: "line",
            datasetIndex: idx,
            encode: { x: "x", y: "y" },
            color: getSeriesColor(lineSeries.id, idx),
            smooth: true,
            symbol: "circle",
            symbolSize: 4,
          });
        }
      });

      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: { type: "cross" },
        },
        legend: {
          show: seriesConfigs.length > 1,
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
        dataset: datasets,
        series: seriesConfigs,
      };
    }

    return null;
  }, [data, series, textColor]);

  // Check if we have empty data
  const hasEmptyData = useMemo(() => {
    if (!data) return true;
    if (data.type === "bigNumber") return false;
    if (data.type === "bar") {
      return (
        data.series.length === 0 ||
        data.series.every((s) => s.groups.length === 0)
      );
    }
    if (data.type === "linechart") {
      return (
        data.series.length === 0 ||
        data.series.every((s) => {
          if (s.data) return s.data.length === 0;
          if (s.groups)
            return (
              s.groups.length === 0 ||
              s.groups.every((g) => g.dates.length === 0)
            );
          return true;
        })
      );
    }
    return true;
  }, [data]);

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
      ) : !data ? (
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
              chartsContext.registerChart(chartId, chart);
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
