import {
  MetricExplorerBlockInterface,
  blockHasFieldOfType,
} from "shared/enterprise";
import { useMemo } from "react";
import { getValidDate } from "shared/dates";
import { Box, Text, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { FaExclamationTriangle } from "react-icons/fa";
import { isString } from "shared/util";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCurrency } from "@/hooks/useCurrency";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import HelperText from "@/ui/HelperText";
import { useDashboardMetricAnalysis } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import { BlockProps } from ".";

export default function MetricExplorerBlock({
  block,
  setBlock,
  metricAnalysis,
  factMetric,
}: BlockProps<MetricExplorerBlockInterface>) {
  const { visualizationType, valueType, analysisSettings } = block;
  const { getFactTableById } = useDefinitions();
  const { loading, error } = useDashboardMetricAnalysis(block, setBlock);
  const displayCurrency = useCurrency();
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const chartsContext = useDashboardCharts();

  const chartId = useMemo(() => {
    if (blockHasFieldOfType(block, "id", isString) && block.id) {
      return `metric-explorer-${block.id}`;
    }
    // Fallback to a stable ID based on block properties
    return `metric-explorer-${block.metricAnalysisId || "unknown"}`;
  }, [block]);

  const formatterOptions = useMemo(
    () => ({ currency: displayCurrency }),
    [displayCurrency],
  );

  const chartData = useMemo(() => {
    const data: { x: string | number | Date; y: number }[] = [];

    const rawFormatter = getExperimentMetricFormatter(
      factMetric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    const rows = (metricAnalysis.result?.dates || [])
      .map((r) => {
        return { ...r, date: getValidDate(r.date) };
      })
      .filter((d) => {
        if (d.date < analysisSettings.startDate) return false;
        if (d.date > analysisSettings.endDate) return false;
        return true;
      });

    if (visualizationType === "bigNumber") {
      const sum = rows.reduce((acc, curr) => {
        const value =
          valueType === "avg" ? curr.mean || 0 : curr.mean * (curr.units || 0);
        return acc + value;
      }, 0);

      return {
        value: valueType === "sum" ? sum : sum / (rows.length || 1),
        formatter,
      };
    } else if (
      visualizationType === "histogram" &&
      factMetric.metricType === "mean"
    ) {
      metricAnalysis.result?.histogram?.forEach((row) => {
        data.push({
          x: `${formatter(row.start)} - ${formatter(row.end)}`,
          y: row.units,
        });
      });
    } else if (visualizationType === "timeseries") {
      rows.forEach((row) => {
        if (valueType === "sum" && factMetric.metricType !== "ratio") {
          data.push({ x: row.date, y: (row.mean || 0) * (row.units || 0) });
        } else {
          data.push({
            x: row.date,
            y: row.mean || 0,
          });
        }
      });
    }

    const option = {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        valueFormatter: (value: number) => {
          return formatter(value);
        },
      },
      xAxis: {
        type: visualizationType === "timeseries" ? "time" : "category",
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
        axisLabel: {
          color: textColor,
          formatter: visualizationType !== "histogram" ? formatter : undefined,
        },
      },
      dataset: [
        {
          source: data,
        },
      ],
      series: [
        {
          type: visualizationType === "histogram" ? "bar" : "line",
          encode: {
            x: "x",
            y: "y",
          },
        },
      ],
    };
    return option;
  }, [
    factMetric,
    valueType,
    visualizationType,
    metricAnalysis,
    analysisSettings.startDate,
    analysisSettings.endDate,
    textColor,
    formatterOptions,
    getFactTableById,
  ]);

  return (
    <Box
      p="4"
      position="relative"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
      }}
    >
      {error ? (
        <Callout status="error">{error.toString()}</Callout>
      ) : loading ? (
        <LoadingOverlay />
      ) : !metricAnalysis ? (
        <Box p="4" style={{ textAlign: "center" }}>
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            No cached data available. Refresh to see results.
          </Text>
        </Box>
      ) : metricAnalysis.status === "error" ? (
        <Box
          p="4"
          overflow="scroll"
          style={{
            backgroundColor: "var(--red-a3)",
            borderRadius: "var(--radius-4)",
          }}
        >
          <Flex align="center" gap="4" justify="between">
            <HelperText status="error">
              {metricAnalysis.error || "There was an error with the analysis"}
            </HelperText>
            <ViewAsyncQueriesButton
              queries={metricAnalysis.queries.map((q) => q.query)}
              error={metricAnalysis.error}
              display="View error(s)"
              color="danger"
              status="failed"
              icon={<FaExclamationTriangle className="mr-2" />}
              condensed={true}
              hideQueryCount={true}
            />
          </Flex>
        </Box>
      ) : ["running", "queued"].includes(metricAnalysis.status || "") ? (
        <LoadingOverlay />
      ) : "dataset" in chartData &&
        Array.isArray(chartData.dataset) &&
        !chartData.dataset[0]?.source?.length ? (
        <Box p="4" style={{ textAlign: "center" }}>
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            The query ran successfully, but no data was returned.
          </Text>
        </Box>
      ) : visualizationType === "bigNumber" ? (
        <BigValueChart
          value={(chartData && "value" in chartData && chartData.value) || 0}
          formatter={
            (chartData as { formatter: (value: number) => string }).formatter
          }
        />
      ) : (
        <EChartsReact
          key={JSON.stringify(chartData)}
          option={chartData}
          style={{ width: "100%", minHeight: "450px", height: "80%" }}
          onChartReady={(chart) => {
            if (chartsContext && chart) {
              chartsContext.registerChart(chartId, chart);
            }
          }}
        />
      )}
    </Box>
  );
}
