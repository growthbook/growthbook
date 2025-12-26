import { useCallback, useMemo } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import Decimal from "decimal.js";
import {
  DataVizConfig,
  dataVizConfigValidator,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
  dimensionAxisConfiguration,
} from "shared/validators";
import { getValidDate } from "shared/dates";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { supportsDimension } from "@/services/dataVizTypeGuards";
import { getXAxisConfig } from "@/services/dataVizConfigUtilities";
import { formatNumber } from "@/services/metrics";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import BigValueChart from "../SqlExplorer/BigValueChart";
import DataVizConfigPanel from "./DataVizConfigPanel";
import PivotTable from "./PivotTable";

// We need to use any here because the rows are defined only in runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];

function parseYValue(
  row: Rows[number],
  yField: string | undefined,
  yType: string,
): number | string | undefined {
  if (yField && yField in row) {
    const yValue = row[yField];
    if (yType === "string") {
      return yValue + "";
    } else if (yType === "date") {
      return getValidDate(yValue).toISOString();
    } else {
      return yValue * 1;
    }
  }
  return undefined;
}

function aggregate(
  values: (string | number)[],
  aggregation: yAxisAggregationType,
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
    case "average": {
      if (numericValues.length === 0) return 0;
      const sum = numericValues.reduce(
        (acc, value) => acc.plus(value),
        new Decimal(0),
      );
      return sum.dividedBy(numericValues.length).toNumber();
    }
    case "sum":
      return numericValues
        .reduce((acc, value) => acc.plus(value), new Decimal(0))
        .toNumber();
    case "none":
      return numericValues[0] || 0;
  }
}

function formatter(type: "number" | "string" | "date", value: number) {
  if (type === "number") {
    return formatNumber(value);
  }
  return value;
}

function roundDate(date: Date, unit: xAxisDateAggregationUnit): Date {
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
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day),
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

export function DataVisualizationDisplay({
  rows,
  dataVizConfig,
  chartId,
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
  chartId?: string;
}) {
  const chartsContext = useDashboardCharts();

  const isConfigValid = useMemo(() => {
    const parsed = dataVizConfigValidator.safeParse(dataVizConfig);
    return parsed.success;
  }, [dataVizConfig]);

  const filteredRows = useMemo(() => {
    const filters = dataVizConfig.filters;
    if (!filters || filters.length === 0) return rows;

    return rows.filter((row) => {
      return filters.every((filter) => {
        const { column } = filter;
        const rowValue = row[column];

        // Handle null/undefined values
        if (rowValue == null) return false;

        switch (filter.filterMethod) {
          // Date filters
          case "today": {
            const filterDate = new Date(rowValue);
            if (isNaN(filterDate.getTime())) return false;

            const now = new Date();
            // Compare only the date parts (year/month/day) in UTC
            return (
              filterDate.getFullYear() === now.getUTCFullYear() &&
              filterDate.getMonth() === now.getUTCMonth() &&
              filterDate.getDate() === now.getUTCDate()
            );
          }

          case "last7Days": {
            const filterDate = new Date(rowValue);
            if (isNaN(filterDate.getTime())) return false;

            const now = new Date();
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
            return filterDate >= sevenDaysAgo;
          }

          case "last30Days": {
            const filterDate = new Date(rowValue);
            if (isNaN(filterDate.getTime())) return false;

            const now = new Date();
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
            return filterDate >= thirtyDaysAgo;
          }

          case "dateRange": {
            const filterDate = new Date(rowValue);
            if (isNaN(filterDate.getTime())) return false;

            const startDate = filter.config.startDate
              ? new Date(filter.config.startDate + "T00:00:00.000Z")
              : null;
            const endDate = filter.config.endDate
              ? new Date(filter.config.endDate + "T23:59:59.999Z")
              : null;

            if (startDate && filterDate < startDate) return false;
            if (endDate && filterDate > endDate) return false;
            return true;
          }

          case "numberRange": {
            if (isNaN(rowValue)) return false;

            const min =
              filter.config.min !== undefined
                ? Number(filter.config.min)
                : null;
            const max =
              filter.config.max !== undefined
                ? Number(filter.config.max)
                : null;

            if (min !== null && rowValue < min) return false;
            if (max !== null && rowValue > max) return false;
            return true;
          }
          // Number filters
          case "greaterThan": {
            if (!filter.config.value) return true;
            if (isNaN(rowValue)) return false;

            const threshold = Number(filter.config.value);
            return rowValue > threshold;
          }

          case "greaterThanOrEqualTo": {
            if (!filter.config.value) return true;
            if (isNaN(rowValue)) return false;

            const threshold = Number(filter.config.value);
            return rowValue >= threshold;
          }

          case "lessThan": {
            if (!filter.config.value) return true;
            if (isNaN(rowValue)) return false;

            const threshold = Number(filter.config.value);
            return rowValue < threshold;
          }

          case "lessThanOrEqualTo": {
            if (!filter.config.value) return true;
            if (isNaN(rowValue)) return false;

            const threshold = Number(filter.config.value);
            return rowValue <= threshold;
          }

          case "equalTo": {
            if (!filter.config.value) return true;
            if (isNaN(rowValue)) return false;

            const target = Number(filter.config.value);
            return rowValue === target;
          }

          // String filters
          case "contains": {
            const searchText = filter.config.value;
            if (!searchText) {
              return true;
            }
            return String(rowValue)
              .toLowerCase()
              .includes(searchText.toLowerCase());
          }

          case "includes": {
            const selectedValues = filter.config.values;
            if (!selectedValues) {
              return true;
            }
            return selectedValues.length === 0
              ? true
              : selectedValues.includes(String(rowValue));
          }

          default:
            return true;
        }
      });
    });
  }, [dataVizConfig.filters, rows]);

  // TODO: Support multiple y-axis fields
  const xAxisConfigs = getXAxisConfig(dataVizConfig);
  const xConfig = xAxisConfigs[0];
  const xField = xConfig?.fieldName;
  const yConfig = dataVizConfig.yAxis?.[0];
  const yField = yConfig?.fieldName;
  const aggregation = yConfig?.aggregation || "sum";
  // Get all dimension configurations
  const dimensionConfigs: dimensionAxisConfiguration[] = useMemo(
    () =>
      supportsDimension(dataVizConfig)
        ? (dataVizConfig.dimension ?? [])
        : ([] as dimensionAxisConfiguration[]),
    [dataVizConfig],
  );
  const dimensionFields = dimensionConfigs.map((d) => d.fieldName);

  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";

  // Helper: Generate all combinations of dimension values across all dimensions
  const generateAllDimensionCombinations = useCallback(
    (
      dimensionValuesByField: Map<
        string,
        { values: string[]; hasOther: boolean; maxValues: number }
      >,
    ): string[][] => {
      if (dimensionFields.length === 0) return [];

      let combinations: string[][] = [[]];

      dimensionFields.forEach((field) => {
        const fieldInfo = dimensionValuesByField.get(field);
        if (!fieldInfo) return;

        const valuesToUse = [...fieldInfo.values];
        if (fieldInfo.hasOther) {
          valuesToUse.push("(other)");
        }

        const newCombinations: string[][] = [];
        combinations.forEach((combination) => {
          valuesToUse.forEach((value) => {
            newCombinations.push([...combination, value]);
          });
        });

        combinations = newCombinations;
      });

      return combinations;
    },
    [dimensionFields],
  );

  // If using dimensions, get top X dimension values for each dimension
  const dimensionValuesByField = useMemo(() => {
    const result: Map<
      string,
      { values: string[]; hasOther: boolean; maxValues: number }
    > = new Map();

    if (dimensionFields.length === 0) {
      return result;
    }

    dimensionConfigs.forEach((config) => {
      const dimensionField = config.fieldName;
      const maxValues = config.maxValues || 5;

      // For each dimension value (e.g. "chrome", "firefox"), build a list of all y-values
      const dimensionValueCounts: Map<string, (number | string)[]> = new Map();
      filteredRows.forEach((row) => {
        const dimensionValue = row[dimensionField] + "";
        const yValue = parseYValue(row, yField, yConfig?.type || "number");
        if (yValue !== undefined) {
          dimensionValueCounts.set(dimensionValue, [
            ...(dimensionValueCounts.get(dimensionValue) || []),
            yValue,
          ]);
        }
      });

      // Sort the dimension values by their aggregate y-value descending
      const sortedDimensionValues = Array.from(dimensionValueCounts.entries())
        .map(([dimensionValue, values]) => ({
          dimensionValue,
          value: aggregate(values, aggregation),
        }))
        .sort((a, b) => b.value - a.value)
        .map(({ dimensionValue }) => dimensionValue);

      // If there are at least 2 overflow values, add an "(other)" group
      if (sortedDimensionValues.length > maxValues + 1) {
        result.set(dimensionField, {
          values: sortedDimensionValues.slice(0, maxValues),
          hasOther: true,
          maxValues,
        });
      } else {
        result.set(dimensionField, {
          values: sortedDimensionValues,
          hasOther: false,
          maxValues,
        });
      }
    });

    return result;
  }, [
    dimensionFields,
    dimensionConfigs,
    filteredRows,
    yConfig?.type,
    yField,
    aggregation,
  ]);

  const aggregatedRows = useMemo(() => {
    const xType = xConfig?.type;
    if (!xField && !yField) {
      return [];
    }

    const yType = yConfig?.type || "number";

    // Parse each filtered row into a standardized format
    const parsedRows = filteredRows.map((row) => {
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

      // Parse yField value based on yType
      newRow.y = parseYValue(row, yField, yType);

      // Handle all dimensions
      if (dimensionFields.length > 0) {
        newRow.dimensions = {};
        dimensionFields.forEach((dimensionField) => {
          const dimensionValue = row[dimensionField] + "";
          const fieldInfo = dimensionValuesByField.get(dimensionField);
          if (fieldInfo) {
            newRow.dimensions![dimensionField] = fieldInfo.values.includes(
              dimensionValue,
            )
              ? dimensionValue
              : "(other)";
          }
        });
      }

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

    // Group rows by x-value and collect dimension values
    parsedRows.forEach((row, i) => {
      if (row.x == null || row.y == null) return;

      // Create a unique key for this x-value
      const keyData: unknown[] = [];
      if (aggregation === "none") {
        keyData.push(i);
      } else if (xType === "date" && row.x instanceof Date) {
        keyData.push(roundDate(row.x, xConfig?.dateAggregationUnit || "none"));
      } else {
        keyData.push(row.x);
      }

      const key = JSON.stringify(keyData);

      // Initialize group if it doesn't exist
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

      // Add value to top-level y aggregation
      groupedRows[key].y.push(row.y);

      // Group by dimension combination if dimensions exist
      if (row.dimensions && Object.keys(row.dimensions).length > 0) {
        const dimensionKey = dimensionFields
          .map((field) => row.dimensions![field])
          .join(", ");

        if (!groupedRows[key].dimensions[dimensionKey]) {
          groupedRows[key].dimensions[dimensionKey] = [];
        }
        groupedRows[key].dimensions[dimensionKey].push(row.y || 0);
      }
    });

    // Generate all possible dimension combinations for this dataset
    const dimensionCombinations = generateAllDimensionCombinations(
      dimensionValuesByField,
    );

    // Sort dimension combinations directly (they ARE the paths we need!)
    // No need to build a tree - just sort and use them
    const sortedDimensionPaths = [...dimensionCombinations].sort((a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const aVal = a[i] || "";
        const bVal = b[i] || "";
        const cmp = aVal.localeCompare(bVal);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    // Pre-calculate rowSpans for each path depth
    // RowSpan = how many leaf paths share this prefix at this depth
    const rowSpans = new Map<string, number>();
    sortedDimensionPaths.forEach((path) => {
      path.forEach((_, depth) => {
        const key = path.slice(0, depth + 1).join("/");
        if (!rowSpans.has(key)) {
          // Count how many paths share this prefix
          const matchingPaths = sortedDimensionPaths.filter((p) =>
            p.slice(0, depth + 1).every((val, idx) => val === path[idx]),
          );
          rowSpans.set(key, matchingPaths.length);
        }
      });
    });

    // Apply aggregation to each group
    const aggregatedRows = Object.values(groupedRows).map((group) => {
      const row: Record<string, unknown> = {
        x: group.x,
        y: aggregate(group.y, aggregation || "sum"),
        _dimensionFields: dimensionFields,
        _xAxisFields: xField ? [xField] : [],
      };

      if (dimensionFields.length > 0) {
        // For each combination of dimension values, add a column
        const dimensionValuesByCombo: Record<
          string,
          Record<string, string>
        > = {};

        dimensionCombinations.forEach((combination) => {
          const dimensionKey = combination.join(", ");
          row[dimensionKey] =
            dimensionKey in group.dimensions
              ? aggregate(group.dimensions[dimensionKey], aggregation)
              : undefined;

          // Store structured dimension values for this combo
          dimensionValuesByCombo[dimensionKey] = {};
          dimensionFields.forEach((field, idx) => {
            dimensionValuesByCombo[dimensionKey][field] = combination[idx];
          });
        });

        row._dimensionValuesByCombo = dimensionValuesByCombo;
      }

      return row;
    });

    // Add pivot-table-specific metadata (only if dimensions exist)
    if (dimensionFields.length > 0 && aggregatedRows.length > 0) {
      aggregatedRows[0]._pivotDimensionPaths = sortedDimensionPaths;
      aggregatedRows[0]._pivotRowSpans = Object.fromEntries(rowSpans);
      aggregatedRows[0]._pivotDimensionFields = dimensionFields;
    }

    if (
      xConfig?.type === "string" &&
      xConfig?.sort &&
      xConfig?.sort !== "none"
    ) {
      // Sort by x value if specified
      aggregatedRows.sort((a, b) => {
        if (xConfig?.sort === "asc") {
          return (a.x + "").localeCompare(b.x + "");
        } else if (xConfig?.sort === "desc") {
          return (b.x + "").localeCompare(a.x + "");
        } else if (xConfig?.sort === "valueAsc") {
          return (a.y as number) - (b.y as number);
        } else if (xConfig?.sort === "valueDesc") {
          return (b.y as number) - (a.y as number);
        } else {
          return 0;
        }
      });
    } else if (xConfig?.type === "number" || xConfig?.type === "date") {
      // Always sort in ascending order
      aggregatedRows.sort((a, b) => {
        if (xConfig?.type === "date") {
          return (
            getValidDate(a.x as string).getTime() -
            getValidDate(b.x as string).getTime()
          );
        } else {
          return (a.x as number) * 1 - (b.x as number) * 1;
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
    yConfig?.type,
    dimensionFields,
    dimensionValuesByField,
    filteredRows,
    generateAllDimensionCombinations,
  ]);

  const dataset = useMemo(() => {
    return [
      {
        source: aggregatedRows,
      },
    ];
  }, [aggregatedRows]);

  const series = useMemo(() => {
    if (dimensionFields.length === 0) {
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

    // Generate all combinations of dimension values for series
    const dimensionCombinations = generateAllDimensionCombinations(
      dimensionValuesByField,
    );

    // Use the first dimension's display setting for stacking
    const shouldStack = dimensionConfigs[0]?.display === "stacked";

    return dimensionCombinations.map((combination) => {
      const dimensionKey = combination.join(", ");
      return {
        name: dimensionKey,
        type:
          dataVizConfig.chartType === "area" ? "line" : dataVizConfig.chartType,
        ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
        stack: shouldStack ? "stack" : undefined,
        encode: {
          x: "x",
          y: dimensionKey,
        },
      };
    });
  }, [
    dataVizConfig.chartType,
    xField,
    dimensionFields,
    dimensionValuesByField,
    dimensionConfigs,
    generateAllDimensionCombinations,
  ]);

  const option = useMemo(() => {
    return {
      dataset,
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        valueFormatter: (value: number) => {
          if (!yConfig?.type) {
            return value;
          }
          return formatter(yConfig.type, value);
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
      ...(dimensionFields.length > 0
        ? {
            legend: {
              textStyle: {
                color: textColor,
              },
              top: "bottom",
              type: "scroll",
            },
          }
        : null),
      xAxis: {
        name:
          xConfig?.type === "date" && xConfig?.dateAggregationUnit !== "none"
            ? `${xConfig?.dateAggregationUnit} (${xField})`
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
        scale: true,
        type:
          xConfig?.type === "date"
            ? "time"
            : xConfig?.type === "number"
              ? "value"
              : "category",
      },
      yAxis: {
        scale: true,
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
    dimensionFields,
    dataVizConfig.title,
    textColor,
    yConfig?.type,
  ]);

  if (dataVizConfig.chartType === "big-value") {
    const yField = dataVizConfig.yAxis?.[0]?.fieldName ?? "";
    const aggregation = dataVizConfig.yAxis?.[0]?.aggregation ?? "sum";
    const format = dataVizConfig.format ?? "shortNumber";
    const yConfig = dataVizConfig.yAxis?.[0];
    const values = rows
      .map((row) => parseYValue(row, yField, yConfig?.type || "number"))
      .filter((v) => v !== undefined && v !== null);
    const value = aggregate(values, aggregation);
    return (
      <BigValueChart
        value={value}
        label={dataVizConfig.title}
        format={format}
      />
    );
  }

  if (dataVizConfig.chartType === "pivot-table") {
    if (!dataVizConfig.xAxes || !dataVizConfig.yAxis) {
      return (
        <Flex justify="center" align="center" height="100%">
          Select rows, columns, and a measure value on the side panel to
          visualize your data.
        </Flex>
      );
    }

    if (!aggregatedRows.length) {
      return (
        <Flex justify="center" align="center" height="100%">
          No data to visualize.
        </Flex>
      );
    }

    return (
      <PivotTable
        aggregatedRows={aggregatedRows}
        dataVizConfig={dataVizConfig}
      />
    );
  }

  if (isConfigValid) {
    return (
      <Flex justify="center" align="center" height="100%" overflowY="auto">
        <EChartsReact
          key={JSON.stringify(option)}
          option={option}
          style={{ width: "100%", minHeight: "350px", height: "80%" }}
          onChartReady={(chart) => {
            if (chartId && chartsContext && chart) {
              chartsContext.registerChart(chartId, chart);
            }
          }}
        />
      </Flex>
    );
  } else {
    return (
      <Flex justify="center" align="center" height="100%">
        Select X and Y axis on the side panel to visualize your data.
      </Flex>
    );
  }
}

export function SqlExplorerDataVisualization({
  rows,
  dataVizConfig,
  onDataVizConfigChange,
  showPanel = true,
  graphTitle = "Visualization",
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  showPanel?: boolean;
  graphTitle?: string;
}) {
  return (
    <PanelGroup direction="horizontal">
      <Panel
        id="graph"
        order={1}
        defaultSize={showPanel ? 75 : 100}
        minSize={55}
      >
        <AreaWithHeader
          header={
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              {graphTitle}
            </Text>
          }
        >
          <DataVisualizationDisplay rows={rows} dataVizConfig={dataVizConfig} />
        </AreaWithHeader>
      </Panel>
      {showPanel ? (
        <>
          <PanelResizeHandle />
          <Panel id="graph-config" order={2} defaultSize={25} minSize={20}>
            <Box style={{ overflow: "auto", height: "100%" }}>
              <DataVizConfigPanel
                rows={rows}
                dataVizConfig={dataVizConfig}
                onDataVizConfigChange={onDataVizConfigChange}
              />
            </Box>
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );
}
