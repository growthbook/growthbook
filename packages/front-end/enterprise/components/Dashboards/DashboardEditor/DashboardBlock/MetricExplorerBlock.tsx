import { MetricExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import { getValidDate } from "shared/dates";
import { Box, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCurrency } from "@/hooks/useCurrency";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
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

  const chartData = useMemo(() => {
    const rawFormatter = getExperimentMetricFormatter(
      factMetric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    // Check if we have slices
    const hasSlices = (metricAnalysis.result?.slices?.length || 0) > 0;
    const slices = metricAnalysis.result?.slices || [];

    // Helper to format slice label
    const formatSliceLabel = (slice: Record<string, string | null>): string => {
      const parts = Object.entries(slice)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([col, val]) => {
          if (val === null) {
            return `${col}: null`;
          }
          return `${col}: ${val}`;
        });
      return parts.join(" + ");
    };

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
        // Get all unique dates across overall and slices
        const allDates = new Set<Date>();
        rows.forEach((r) => allDates.add(r.date));
        slices.forEach((slice) => {
          (slice.dates || []).forEach((d) => {
            allDates.add(getValidDate(d.date));
          });
        });

        const sortedDates = Array.from(allDates).sort(
          (a, b) => a.getTime() - b.getTime(),
        );

        // Build series names first (before building dataset to avoid duplicates)
        const seriesNames: string[] = [];
        slices.forEach((slice) => {
          const sliceLabel = formatSliceLabel(slice.slice);
          if (!seriesNames.includes(sliceLabel)) {
            seriesNames.push(sliceLabel);
          }
        });

        // Build dataset: one row per date with columns for overall and each slice
        const datasetSource: Record<string, unknown>[] = [];

        sortedDates.forEach((date) => {
          const row: Record<string, unknown> = { x: date };

          // Add slice values (using pre-built seriesNames to ensure consistency)
          slices.forEach((slice) => {
            const sliceLabel = formatSliceLabel(slice.slice);

            const sliceDateRow = (slice.dates || []).find(
              (d) => getValidDate(d.date).getTime() === date.getTime(),
            );
            if (sliceDateRow) {
              const mean = sliceDateRow.mean ?? 0;
              const units = sliceDateRow.units ?? 0;
              const value =
                valueType === "sum" && factMetric.metricType !== "ratio"
                  ? mean * units
                  : mean;
              // Only add if value is a valid number
              if (
                typeof value === "number" &&
                !isNaN(value) &&
                isFinite(value)
              ) {
                row[sliceLabel] = value;
              }
            }
          });

          datasetSource.push(row);
        });

        // Create series for overall and each slice
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
  ]);

  console.log("chartData", chartData);

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
        <Callout status="error">
          {metricAnalysis.error || "There was an error with the analysis"}
        </Callout>
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
