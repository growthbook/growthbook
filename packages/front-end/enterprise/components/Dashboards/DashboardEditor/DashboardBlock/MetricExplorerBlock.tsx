import { MetricExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import { getValidDate } from "shared/dates";
import { Box, Text, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCurrency } from "@/hooks/useCurrency";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import { formatSliceLabel } from "@/services/dataVizConfigUtilities";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import HelperText from "@/ui/HelperText";
import { useDashboardMetricAnalysis } from "../../DashboardSnapshotProvider";
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
  const formatterOptions = useMemo(
    () => ({ currency: displayCurrency }),
    [displayCurrency],
  );

  const hiddenSeriesIds = useMemo(() => {
    const hidden = new Set<string>();
    block.displaySettings?.seriesOverrides?.forEach((override) => {
      if (override.hidden === true) {
        hidden.add(override.seriesId);
      }
    });
    return hidden;
  }, [block.displaySettings?.seriesOverrides]);

  const chartData = useMemo(() => {
    const rawFormatter = getExperimentMetricFormatter(
      factMetric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    // Check if we have slices (from dates[].slices)
    const hasSlices = (metricAnalysis.result?.dates || []).some(
      (d) => d.slices && d.slices.length > 0,
    );

    if (visualizationType === "bigNumber") {
      const rows = (metricAnalysis.result?.dates || [])
        .map((r) => {
          return { ...r, date: getValidDate(r.date) };
        })
        .filter((d) => {
          if (d.date < analysisSettings.startDate) return false;
          if (d.date > analysisSettings.endDate) return false;
          return true;
        });

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
      const data: { x: string; y: number }[] = [];
      metricAnalysis.result?.histogram?.forEach((row) => {
        data.push({
          x: `${formatter(row.start)} - ${formatter(row.end)}`,
          y: row.units,
        });
      });

      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: {
            type: "shadow",
          },
        },
        xAxis: {
          type: "category",
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
          nameLocation: "middle",
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [40, 0],
            color: textColor,
          },
          axisLabel: {
            color: textColor,
          },
        },
        dataset: [
          {
            source: data,
          },
        ],
        series: [
          {
            type: "bar",
            encode: {
              x: "x",
              y: "y",
            },
          },
        ],
      };
    } else if (visualizationType === "timeseries") {
      const rows = (metricAnalysis.result?.dates || [])
        .map((r) => {
          return { ...r, date: getValidDate(r.date) };
        })
        .filter((d) => {
          if (d.date < analysisSettings.startDate) return false;
          if (d.date > analysisSettings.endDate) return false;
          return true;
        });

      // If we have slices, create multi-series chart
      if (hasSlices) {
        // Build slice series map from dates[].slices
        const sliceSeriesMap = new Map<
          string,
          { date: Date; value: number }[]
        >();

        rows.forEach((r) => {
          (r.slices || []).forEach((s) => {
            const label = formatSliceLabel(s.slice || {});
            const mean = s.mean ?? 0;
            const units = s.units ?? 0;
            const value =
              valueType === "sum" && factMetric.metricType !== "ratio"
                ? mean * units
                : mean;

            if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
              if (!sliceSeriesMap.has(label)) {
                sliceSeriesMap.set(label, []);
              }
              sliceSeriesMap.get(label)!.push({ date: r.date, value });
            }
          });
        });

        // Get all unique dates across all slice series
        const allDates = new Set<Date>();
        sliceSeriesMap.forEach((points) =>
          points.forEach((p) => allDates.add(p.date)),
        );
        const sortedDates = Array.from(allDates).sort(
          (a, b) => a.getTime() - b.getTime(),
        );

        // Build series names from the map keys, filtering out hidden series
        const seriesNames = Array.from(sliceSeriesMap.keys()).filter(
          (name) => !hiddenSeriesIds.has(name),
        );

        // Build dataset: one row per date with columns for each slice
        const datasetSource = sortedDates.map((date) => {
          const row: Record<string, unknown> = { x: date };
          seriesNames.forEach((name) => {
            const point = sliceSeriesMap
              .get(name)!
              .find((p) => p.date.getTime() === date.getTime());
            if (point) {
              row[name] = point.value;
            }
          });
          return row;
        });

        // Create series for each slice
        const series = seriesNames.map((name) => ({
          name,
          type: "line",
          encode: {
            x: "x",
            y: name,
          },
        }));

        return {
          tooltip: {
            appendTo: "body",
            trigger: "axis",
            axisPointer: {
              type: "line",
            },
          },
          legend: {
            show: true,
            data: seriesNames,
            textStyle: {
              color: textColor,
            },
          },
          xAxis: {
            type: "time",
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
            nameLocation: "middle",
            nameTextStyle: {
              fontSize: 14,
              fontWeight: "bold",
              padding: [40, 0],
              color: textColor,
            },
            axisLabel: {
              color: textColor,
              formatter,
            },
          },
          dataset: [
            {
              source: datasetSource,
            },
          ],
          series,
        };
      }

      // No slices - use single series (original behavior)
      const data: { x: Date; y: number }[] = [];
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

      return {
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          axisPointer: {
            type: "shadow",
          },
        },
        xAxis: {
          type: "time",
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
          nameLocation: "middle",
          nameTextStyle: {
            fontSize: 14,
            fontWeight: "bold",
            padding: [40, 0],
            color: textColor,
          },
          axisLabel: {
            color: textColor,
            formatter,
          },
        },
        dataset: [
          {
            source: data,
          },
        ],
        series: [
          {
            type: "line",
            encode: {
              x: "x",
              y: "y",
            },
          },
        ],
      };
    }

    // Fallback for other visualization types (should not be reached for timeseries/histogram/bigNumber)
    return {
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
        type: "category",
        nameLocation: "middle",
        scale: true,
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
        scale: true,
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [40, 0],
          color: textColor,
        },
        axisLabel: {
          color: textColor,
          formatter,
        },
      },
      dataset: [
        {
          source: [],
        },
      ],
      series: [
        {
          type: "line",
          encode: {
            x: "x",
            y: "y",
          },
        },
      ],
    };
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
    hiddenSeriesIds,
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
        />
      )}
    </Box>
  );
}
