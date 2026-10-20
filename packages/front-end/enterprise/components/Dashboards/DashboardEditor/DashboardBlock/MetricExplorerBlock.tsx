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
  const { loading, error, comparisonMetricAnalysis, compareEnabled } =
    useDashboardMetricAnalysis(block, setBlock);
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
    const comparisonData: { x: string | number | Date; y: number }[] = [];

    const rawFormatter = getExperimentMetricFormatter(
      factMetric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    const curStart = getValidDate(analysisSettings.startDate);
    const curEnd = getValidDate(analysisSettings.endDate);
    const spanMs = curEnd.getTime() - curStart.getTime();

    const rows = (metricAnalysis.result?.dates || [])
      .map((r) => {
        return { ...r, date: getValidDate(r.date) };
      })
      .filter((d) => {
        if (d.date < curStart) return false;
        if (d.date > curEnd) return false;
        return true;
      });

    // Previous-period rows already come scoped to the prior window from their
    // own analysis. For the timeseries we shift them forward by the window
    // length so they overlay the current axis point-for-point.
    const comparisonRows =
      compareEnabled && comparisonMetricAnalysis
        ? (comparisonMetricAnalysis.result?.dates || []).map((r) => ({
            ...r,
            date: getValidDate(r.date),
          }))
        : [];

    const rowValue = (row: { mean?: number; units?: number }) =>
      valueType === "avg" ? row.mean || 0 : (row.mean || 0) * (row.units || 0);

    if (visualizationType === "bigNumber") {
      const sum = rows.reduce((acc, curr) => acc + rowValue(curr), 0);
      const value = valueType === "sum" ? sum : sum / (rows.length || 1);

      let compareValue: number | undefined = undefined;
      let comparePct: number | undefined = undefined;
      if (compareEnabled && comparisonRows.length) {
        const compareSum = comparisonRows.reduce(
          (acc, curr) => acc + rowValue(curr),
          0,
        );
        compareValue =
          valueType === "sum"
            ? compareSum
            : compareSum / (comparisonRows.length || 1);
        comparePct =
          compareValue !== 0
            ? (value - compareValue) / Math.abs(compareValue)
            : undefined;
      }

      return { value, formatter, compareValue, comparePct };
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
      comparisonRows.forEach((row) => {
        const shifted = new Date(row.date.getTime() + spanMs);
        if (valueType === "sum" && factMetric.metricType !== "ratio") {
          comparisonData.push({
            x: shifted,
            y: (row.mean || 0) * (row.units || 0),
          });
        } else {
          comparisonData.push({ x: shifted, y: row.mean || 0 });
        }
      });
    }

    // Comparison overlay only makes sense for the timeseries view.
    const showComparisonSeries =
      compareEnabled &&
      visualizationType === "timeseries" &&
      comparisonData.length > 0;

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
      legend: showComparisonSeries
        ? {
            data: ["Current period", "Previous period"],
            textStyle: { color: textColor },
          }
        : undefined,
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
      dataset: [{ source: data }, { source: comparisonData }],
      series: [
        {
          name: "Current period",
          type: visualizationType === "histogram" ? "bar" : "line",
          encode: {
            x: "x",
            y: "y",
          },
          datasetIndex: 0,
        },
        ...(showComparisonSeries
          ? [
              {
                name: "Previous period",
                type: "line",
                encode: { x: "x", y: "y" },
                datasetIndex: 1,
                lineStyle: { type: "dashed" },
                itemStyle: { color: "#999999" },
              },
            ]
          : []),
      ],
    };
    return option;
  }, [
    factMetric,
    valueType,
    visualizationType,
    metricAnalysis,
    comparisonMetricAnalysis,
    compareEnabled,
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
          compareSlot={
            compareEnabled &&
            "comparePct" in chartData &&
            chartData.comparePct !== undefined ? (
              <Text
                as="div"
                size="2"
                weight="medium"
                mt="1"
                style={{
                  color:
                    chartData.comparePct >= 0
                      ? "var(--green-11)"
                      : "var(--red-11)",
                }}
              >
                {new Intl.NumberFormat(undefined, {
                  style: "percent",
                  maximumFractionDigits: 1,
                  signDisplay: "exceptZero",
                }).format(chartData.comparePct)}{" "}
                vs. previous period
              </Text>
            ) : undefined
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
