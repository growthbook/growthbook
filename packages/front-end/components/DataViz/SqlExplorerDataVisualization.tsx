import { useMemo } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";
import {
  DataVizConfig,
  dataVizConfigValidator,
  XAxisDateAggregationUnit,
  YAxisAggregationType,
} from "back-end/src/validators/saved-queries";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import DataVizConfigPanel from "./DataVizConfigPanel";

// We need to use any here because the rows are defined only in runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];

function aggregate(
  values: (string | number)[],
  aggregation: YAxisAggregationType
): number {
  const numericValues = values
    .map((v) => {
      if (typeof v === "string") {
        const parsed = parseFloat(v);
        return parsed;
      }
      return typeof v === "number" ? v : 0;
    })
    .filter((v) => !isNaN(v));

  switch (aggregation) {
    case "min":
      return Math.min(...numericValues) || 0;
    case "max":
      return Math.max(...numericValues) || 0;
    case "first":
      return numericValues[0] || 0;
    case "last":
      return numericValues[numericValues.length - 1] || 0;
    case "count":
      return values.length;
    case "countDistinct":
      return new Set(values).size;
    case "average":
      return numericValues.length > 0
        ? numericValues.reduce((sum, value) => sum + value, 0) /
            numericValues.length
        : 0;
    case "sum":
      return numericValues.reduce((sum, value) => sum + value, 0);
    case "none":
      return numericValues[0] || 0;
  }
}

function roundDate(date: Date, unit: XAxisDateAggregationUnit): Date {
  const d = new Date(date.getTime()); // clone the date

  switch (unit) {
    case "second":
      d.setUTCMilliseconds(0);
      return d;
    case "minute":
      d.setUTCSeconds(0, 0); // Round to the start of the second
      return d;
    case "hour":
      d.setUTCMinutes(0, 0, 0); // Round to the start of the hour
      return d;
    case "day": {
      d.setUTCHours(0, 0, 0, 0); // Round to the start of the day
      return d;
    }

    case "week": {
      const day = d.getUTCDay(); // Sunday = 0
      const startOfWeek = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
      );
      startOfWeek.setUTCHours(0, 0, 0, 0); // Round to the start of the week
      return startOfWeek;
    }
    case "month": {
      d.setUTCDate(1); // Round to the start of the month
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case "year": {
      d.setUTCMonth(0, 1); // Round to the start of the year
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case "none":
      return date;
  }
}

export default function SqlExplorerDataVisualization({
  rows,
  dataVizConfig,
  onDataVizConfigChange,
  showPanel = true,
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  showPanel?: boolean;
}) {
  const isConfigValid = useMemo(() => {
    const parsed = dataVizConfigValidator.strip().safeParse(dataVizConfig);
    return parsed.success;
  }, [dataVizConfig]);

  // TODO: Support multiple y-axis and dimension fields
  const xConfig = dataVizConfig.xAxis;
  const xField = xConfig?.fieldName;
  const yConfig = dataVizConfig.yAxis?.[0];
  const yField = yConfig?.fieldName;
  const aggregation = yConfig?.aggregation || "sum";
  const dimensionConfig = dataVizConfig.dimension?.[0];
  const dimensionField = dimensionConfig?.fieldName;

  const { theme } = useAppearanceUITheme();

  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";

  // If using a dimension, get top 10 dimension values
  const { dimensionValues, hasOtherDimension } = useMemo(() => {
    if (!dimensionField) {
      return { dimensionValues: [], hasOtherDimension: false };
    }

    const dimensionValueCounts: Map<string, number> = new Map();
    rows.forEach((row) => {
      const dimensionValue: unknown = row[dimensionField];
      dimensionValueCounts.set(
        dimensionValue + "",
        (dimensionValueCounts.get(dimensionValue + "") || 0) + 1
      );
    });

    const dimensionValues = Array.from(dimensionValueCounts.entries())
      .sort((a, b) => {
        return b[1] - a[1];
      })
      .map(([value]) => value);

    const maxValues = dimensionConfig?.maxValues || 5;
    // If there are at least 2 overflow values
    if (dimensionValues.length > maxValues + 1) {
      return {
        dimensionValues: dimensionValues.slice(0, maxValues),
        hasOtherDimension: true,
      };
    }

    return {
      dimensionValues,
      hasOtherDimension: false,
    };
  }, [dimensionField, rows, dimensionConfig?.maxValues]);

  const aggregatedRows = useMemo(() => {
    const xType = xConfig?.type;
    if (!xField && !yField) {
      return [];
    }

    const parsedRows = rows.map((row) => {
      const newRow: {
        x?: number | Date | string;
        y?: string | number;
        dimensions?: Record<string, string>;
      } = {};

      // Cast xField value based on xType
      if (xField && xField in row) {
        const xValue = row[xField];
        if (xValue == null) {
          newRow.x = undefined;
        } else if (xType === "number") {
          newRow.x =
            typeof xValue === "string"
              ? parseFloat(xValue) || 0
              : Number(xValue);
        } else if (xType === "date") {
          newRow.x = new Date(xValue);
        } else if (xType === "string") {
          newRow.x = xValue + "";
        }
      }

      // Cast yField to number
      if (yField && yField in row) {
        const yValue = row[yField];
        if (aggregation === "countDistinct") {
          newRow.y = yValue + "";
        } else {
          newRow.y = typeof yValue === "string" ? 1 : Number(yValue);
        }
      }

      if (dimensionField) {
        const dimensionValue = row[dimensionField] + "";
        newRow.dimensions = {
          [dimensionField]: dimensionValues.includes(dimensionValue)
            ? dimensionValue
            : "(other)",
        };
      }

      // TODO: support multiple y-axis and dimension fields

      return newRow;
    });

    // Group by x-value
    const groupedRows: Record<
      string,
      {
        x: number | Date | string;
        dimensions: Record<string, (string | number)[]>;
        y: (string | number)[];
      }
    > = {};
    parsedRows.forEach((row, i) => {
      if (row.x == null || row.y == null) return;

      const keyData: unknown[] = [];
      if (aggregation === "none") {
        keyData.push(i);
      } else if (xType === "date" && row.x instanceof Date) {
        keyData.push(roundDate(row.x, xConfig?.dateAggregationUnit || "none"));
      } else {
        keyData.push(row.x);
      }

      const key = JSON.stringify(keyData);
      if (!groupedRows[key]) {
        groupedRows[key] = {
          x:
            xType === "date" && row.x instanceof Date
              ? roundDate(row.x, xConfig?.dateAggregationUnit || "none")
              : row.x,
          dimensions: {},
          y: [],
        };
      }

      // Add value to top-level
      groupedRows[key].y.push(row.y);

      // Add value to dimension
      Object.entries(row.dimensions || {}).forEach(([k, v]) => {
        const dimensionKey = k + ": " + v;
        if (!groupedRows[key].dimensions[dimensionKey]) {
          groupedRows[key].dimensions[dimensionKey] = [];
        }
        groupedRows[key].dimensions[dimensionKey].push(row.y || 0);
      });
    });

    // Apply aggregation to each group
    const aggregatedRows = Object.values(groupedRows).map((group) => {
      const row: Record<string, unknown> = {
        x: group.x,
        y: aggregate(group.y, aggregation || "sum"),
      };

      if (dimensionField) {
        dimensionValues.forEach((value) => {
          const dimensionKey = dimensionField + ": " + value;
          row[dimensionKey] =
            dimensionKey in group.dimensions
              ? aggregate(group.dimensions[dimensionKey], aggregation)
              : 0;
        });
      }

      return row;
    });

    if (
      xConfig?.type === "string" &&
      xConfig?.sort &&
      xConfig?.sort !== "none"
    ) {
      // Sort by x value if specified
      aggregatedRows.sort((a, b) => {
        if (xConfig.sort === "asc") {
          return (a.x + "").localeCompare(b.x + "");
        } else if (xConfig.sort === "desc") {
          return (b.x + "").localeCompare(a.x + "");
        } else if (xConfig.sort === "valueAsc") {
          return (a.y as number) - (b.y as number);
        } else if (xConfig.sort === "valueDesc") {
          return (b.y as number) - (a.y as number);
        } else {
          return 0;
        }
      });
    }

    return aggregatedRows;
  }, [
    xField,
    xConfig?.type,
    xConfig?.dateAggregationUnit,
    xConfig?.sort,
    aggregation,
    yField,
    dimensionField,
    dimensionValues,
    rows,
  ]);

  const dataset = useMemo(() => {
    return [
      {
        source: aggregatedRows,
      },
    ];
  }, [aggregatedRows]);

  const series = useMemo(() => {
    if (!dimensionField || dimensionValues.length === 0) {
      return [
        {
          name: xField,
          type:
            dataVizConfig.chartType === "area"
              ? "line"
              : dataVizConfig.chartType,
          ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
          encode: {
            x: "x",
            y: "y",
          },
        },
      ];
    }

    const dimensionSeries = dimensionValues.map((value) => {
      return {
        name: value,
        type:
          dataVizConfig.chartType === "area" ? "line" : dataVizConfig.chartType,
        ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
        stack: dimensionConfig?.display === "stacked" ? "stack" : undefined,
        encode: {
          x: "x",
          y: `${dimensionField}: ${value}`,
        },
      };
    });

    if (hasOtherDimension) {
      dimensionSeries.push({
        name: "(other)",
        type:
          dataVizConfig.chartType === "area" ? "line" : dataVizConfig.chartType,
        ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
        stack: dimensionConfig?.display === "stacked" ? "stack" : undefined,
        encode: {
          x: "x",
          y: `${dimensionField}: (other)`,
        },
      });
    }

    return dimensionSeries;
  }, [
    dataVizConfig.chartType,
    xField,
    dimensionField,
    dimensionValues,
    dimensionConfig?.display,
    hasOtherDimension,
  ]);

  const option = useMemo(() => {
    return {
      dataset,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      ...(dataVizConfig.title
        ? {
            title: {
              text: dataVizConfig.title,
              left: "center",
              textStyle: {
                color: textColor,
                fontSize: 20,
                fontWeight: "bold",
              },
            },
          }
        : {}),
      ...(dimensionField
        ? {
            legend: {
              textStyle: {
                color: textColor,
              },
              top: "bottom",
            },
          }
        : null),
      xAxis: {
        name:
          xConfig?.type === "date"
            ? `${xConfig.dateAggregationUnit} (${xField})`
            : xField,
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [10, 0],
          color: textColor,
        },
        axisLabel: {
          color: textColor,
        },
        type:
          xConfig?.type === "date"
            ? "time"
            : xConfig?.type === "number"
            ? "value"
            : "category",
        // axisLabel: { interval: 0, rotate: 30 },
      },
      yAxis: {
        name:
          yConfig?.aggregation && yConfig?.aggregation !== "none"
            ? `${yConfig.aggregation} (${yField})`
            : yField,
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
      series,
    };
  }, [
    dataset,
    series,
    xField,
    yField,
    xConfig?.type,
    xConfig?.dateAggregationUnit,
    yConfig?.aggregation,
    dimensionField,
    dataVizConfig.title,
    textColor,
  ]);

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={showPanel ? 75 : 100}>
        <AreaWithHeader
          header={
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              Graph
            </Text>
          }
        >
          {isConfigValid ? (
            <Flex
              justify="center"
              align="center"
              height="100%"
              overflowY="auto"
            >
              <EChartsReact
                key={JSON.stringify(option)}
                option={option}
                style={{ width: "100%", minHeight: "350px", height: "80%" }}
                echarts={echarts}
              />
            </Flex>
          ) : (
            <Flex justify="center" align="center" height="100%">
              Select X and Y axis on the side panel to visualize your data.
            </Flex>
          )}
        </AreaWithHeader>
      </Panel>
      {showPanel ? (
        <>
          <PanelResizeHandle />
          <Panel defaultSize={25}>
            <AreaWithHeader
              header={
                <Text
                  style={{ color: "var(--color-text-mid)", fontWeight: 500 }}
                >
                  Configuration
                </Text>
              }
            >
              <Box p="4" style={{ overflow: "auto", height: "100%" }}>
                <DataVizConfigPanel
                  sampleRow={rows[0]}
                  dataVizConfig={dataVizConfig}
                  onDataVizConfigChange={onDataVizConfigChange}
                />
              </Box>
            </AreaWithHeader>
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );
}
