import { useCallback, useMemo, type ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import Decimal from "decimal.js";
import {
  DataVizConfig,
  dataVizConfigValidator,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
  dimensionAxisConfiguration,
} from "back-end/src/validators/saved-queries";
import { getValidDate } from "shared/dates";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { supportsDimension } from "@/services/dataVizTypeGuards";
import { getXAxisConfig } from "@/services/dataVizConfigUtilities";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import BigValueChart from "../SqlExplorer/BigValueChart";
import Tooltip from "../Tooltip/Tooltip";
import DataVizConfigPanel from "./DataVizConfigPanel";

// We need to use any here because the rows are defined only in runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];

type PivotTableConfig = Extract<DataVizConfig, { chartType: "pivot-table" }>;

function PivotTableTooltip({
  rowHeader,
  columnHeader,
  value,
  dataVizConfig,
  children,
}: {
  rowHeader: string;
  columnHeader: string;
  value: string | number | null | undefined;
  dataVizConfig: Partial<PivotTableConfig>;
  children: ReactNode;
}) {
  const xAxes = dataVizConfig.xAxes;
  const headerStr = rowHeader + "";
  const [rawTitle, ...rest] = headerStr.split(":");
  const rowTitle = (rawTitle || "").trim();
  const rowValue = rest.join(":").trim();

  const xLabel = xAxes?.[0]?.fieldName;
  const xValue = columnHeader;

  const yFieldName = dataVizConfig.yAxis?.[0]?.fieldName;
  const yAgg = dataVizConfig.yAxis?.[0]?.aggregation;
  const yLabel = yFieldName ? `${yFieldName} (${yAgg})` : undefined;
  const yValue = value;

  return (
    <Tooltip
      body={
        <Flex direction="column" gap="2">
          <Flex direction="row" align="center" justify="between">
            <Text className="font-bold pr-4">{rowTitle}</Text>
            <Text className="pl-4">{rowValue}</Text>
          </Flex>
          {xLabel && (
            <Flex direction="row" align="center" justify="between">
              <Text className="font-bold pr-4">{xLabel}</Text>
              <Text className="pl-4">{xValue}</Text>
            </Flex>
          )}
          {yLabel && (
            <Flex direction="row" align="center" justify="between">
              <Text className="font-bold pr-4">{yLabel}</Text>
              <Text className="pl-4">{yValue}</Text>
            </Flex>
          )}
        </Flex>
      }
    >
      {children}
    </Tooltip>
  );
}

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

// Tree structure for hierarchical pivot table rows
type TreeNode = {
  label: string;
  fullPath: string[];
  children: Map<string, TreeNode>;
  combos: string[]; // Full combo keys that belong to this leaf node
};

// Recursively collect all descendant combo keys from a tree node
function getAllDescendantCombos(node: TreeNode): string[] {
  const combos = [...node.combos];
  node.children.forEach((child) => {
    combos.push(...getAllDescendantCombos(child));
  });
  return combos;
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
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
}) {
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

  // Helper: Create a dimension key from field and value (e.g., "browser: chrome")
  const createDimensionKey = useCallback(
    (field: string, value: string): string => {
      return `${field}: ${value}`;
    },
    [],
  );

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
            newCombinations.push([
              ...combination,
              createDimensionKey(field, value),
            ]);
          });
        });

        combinations = newCombinations;
      });

      return combinations;
    },
    [dimensionFields, createDimensionKey],
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
          .map((field) => createDimensionKey(field, row.dimensions![field]))
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

    // Apply aggregation to each group
    const aggregatedRows = Object.values(groupedRows).map((group) => {
      const row: Record<string, unknown> = {
        x: group.x,
        y: aggregate(group.y, aggregation || "sum"),
      };

      if (dimensionFields.length > 0) {
        // For each combination of dimension values, add a column
        dimensionCombinations.forEach((combination) => {
          const dimensionKey = combination.join(", ");
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
    } else if (xConfig?.type === "number" || xConfig?.type === "date") {
      // Always sort in ascending order
      aggregatedRows.sort((a, b) => {
        if (xConfig.type === "date") {
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
    createDimensionKey,
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
    dimensionFields,
    dataVizConfig.title,
    textColor,
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
          Select X and Y axis on the side panel to visualize your data.
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

    const columnHeaders: string[] = [];
    for (const row of aggregatedRows) {
      columnHeaders.push(
        row.x instanceof Date ? row.x.toLocaleDateString() : row.x + "",
      );
    }

    // Build hierarchical row structure
    type TableRow = {
      header: string;
      values: (string | number | null)[];
      indent: number;
      isBold?: boolean;
    };

    const tableRows: TableRow[] = [];

    if (dimensionFields.length === 0) {
      // No dimensions - just show the y-axis values
      const yFieldName = dataVizConfig.yAxis?.[0]?.fieldName;
      const yAggregation = dataVizConfig.yAxis?.[0]?.aggregation;
      tableRows.push({
        header: yFieldName ? `${yFieldName} (${yAggregation})` : "y",
        values: aggregatedRows.map((row) => row.y as number),
        indent: 0,
      });
    } else if (dimensionFields.length === 1) {
      // Single dimension - no nesting needed
      const dimensionCombos = new Set<string>();
      aggregatedRows.forEach((row) => {
        Object.keys(row).forEach((k) => {
          if (k !== "x" && k !== "y") {
            dimensionCombos.add(k);
          }
        });
      });

      Array.from(dimensionCombos)
        .sort()
        .forEach((combo) => {
          tableRows.push({
            header: combo,
            values: aggregatedRows.map((row) =>
              row[combo] !== undefined ? (row[combo] as number) : null,
            ),
            indent: 0,
          });
        });
    } else {
      // Multiple dimensions - build recursive hierarchical structure
      // Collect all dimension combination keys from aggregatedRows
      const dimensionCombos = new Set<string>();
      aggregatedRows.forEach((row) => {
        Object.keys(row).forEach((k) => {
          if (k !== "x" && k !== "y") {
            dimensionCombos.add(k);
          }
        });
      });

      // Build a tree from dimension combinations (e.g., "browser: chrome, country: USA")
      const root: TreeNode = {
        label: "",
        fullPath: [],
        children: new Map(),
        combos: [],
      };

      // Parse each combo and build the tree
      dimensionCombos.forEach((combo) => {
        const parts = combo.split(", ");
        let currentNode = root;

        parts.forEach((part, index) => {
          if (!currentNode.children.has(part)) {
            currentNode.children.set(part, {
              label: part,
              fullPath: [...currentNode.fullPath, part],
              children: new Map(),
              combos: [],
            });
          }
          currentNode = currentNode.children.get(part)!;

          // If this is the last part, this is a leaf node - store the full combo
          if (index === parts.length - 1) {
            currentNode.combos.push(combo);
          }
        });
      });

      // Recursively render the tree into table rows
      const renderTree = (node: TreeNode, depth: number): void => {
        // Sort children alphabetically
        const sortedChildren = Array.from(node.children.entries()).sort(
          ([a], [b]) => a.localeCompare(b),
        );

        sortedChildren.forEach(([_key, childNode]) => {
          // Get all combo keys for this node and its descendants
          const descendantCombos = getAllDescendantCombos(childNode);

          // Calculate aggregated values across all x-axis columns
          const nodeValues = aggregatedRows.map((row) => {
            // Sum values from all descendant combinations
            return descendantCombos.reduce(
              (total, combo) =>
                total + (row[combo] !== undefined ? (row[combo] as number) : 0),
              0,
            );
          });

          // Leaf nodes show actual data; parent nodes show aggregated totals
          const isLeaf =
            childNode.combos.length > 0 && childNode.children.size === 0;

          tableRows.push({
            header: childNode.label,
            values: nodeValues,
            indent: depth,
            isBold: !isLeaf, // Non-leaf nodes are bold
          });

          // Recursively render children
          if (childNode.children.size > 0) {
            renderTree(childNode, depth + 1);
          }
        });
      };

      renderTree(root, 0);
    }

    let maxCellValue = 0;
    for (const row of tableRows) {
      for (const value of row.values) {
        if (typeof value === "number" && Number.isFinite(value)) {
          if (value > maxCellValue) maxCellValue = value;
        }
      }
    }

    return (
      <div style={{ height: "100%" }}>
        <Flex
          justify="start"
          align="center"
          direction="column"
          style={{
            overflowX: "auto",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            height: "100%",
            flex: 1,
          }}
        >
          <div className="p-4" style={{ width: "100%" }}>
            <h4 style={{ textAlign: "center" }}>{dataVizConfig.title}</h4>
            <Table variant="surface">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader />
                  {columnHeaders.map((header, i) => (
                    <TableColumnHeader key={`${header}-${i}`}>
                      {header}
                    </TableColumnHeader>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row, rowIndex) => (
                  <TableRow key={`${row.header}-${rowIndex}`}>
                    <TableCell
                      style={{
                        paddingLeft: `${12 + row.indent * 24}px`,
                        fontWeight: row.isBold ? "bold" : "normal",
                      }}
                    >
                      {row.header}
                    </TableCell>
                    {row.values.map((value, i) => (
                      <TableCell
                        role="button"
                        key={i}
                        style={{
                          fontWeight: row.isBold ? "bold" : "normal",
                          background:
                            typeof value === "number" && maxCellValue > 0
                              ? `color-mix(in srgb, #5071de ${Math.round(
                                  Math.max(
                                    0,
                                    Math.min(1, value / maxCellValue),
                                  ) * 85,
                                )}%, transparent)`
                              : undefined,
                        }}
                      >
                        <PivotTableTooltip
                          rowHeader={row.header}
                          columnHeader={columnHeaders[i]}
                          value={value}
                          dataVizConfig={dataVizConfig}
                        >
                          {value !== null && value !== undefined ? value : "-"}
                        </PivotTableTooltip>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Flex>
      </div>
    );
  }

  if (isConfigValid) {
    return (
      <Flex justify="center" align="center" height="100%" overflowY="auto">
        <EChartsReact
          key={JSON.stringify(option)}
          option={option}
          style={{ width: "100%", minHeight: "350px", height: "80%" }}
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
