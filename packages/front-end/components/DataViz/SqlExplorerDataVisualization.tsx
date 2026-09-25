import { useCallback, useMemo, useRef } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { color as echartsColor } from "echarts";
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
import { getChartThemeColors } from "@/enterprise/components/ProductAnalytics/chart-theme";
import { supportsDimension } from "@/services/dataVizTypeGuards";
import { getXAxisConfig } from "@/services/dataVizConfigUtilities";
import { formatNumber } from "@/services/metrics";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
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

const CHART_ANIMATION_CONFIG = {
  animation: true,
  animationDuration: 300,
  animationEasing: "linear" as const,
  symbol: "circle",
  symbolSize: 4,
};

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
  seriesColors,
  legendPosition = "bottom",
  legendAlign = "center",
  showAxisNames = true,
  grid,
  barMaxWidth,
  chartHeight,
  yAxisSplitNumber,
  legendPadding,
  showLegend = true,
  yAxisLabelFormatter,
  markLineLabelDistance,
  markLines,
  selection,
  selectionDimOpacity = 0.25,
  onSelect,
  markLineOvershoot,
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
  chartId?: string;
  /**
   * Group name -> colour. Keyed by name rather than by array index so a colour
   * survives any reordering of the series, and set per series rather than as
   * `option.color` for the same reason. Omitted leaves ECharts' own palette in
   * place, which is what every existing caller gets.
   */
  seriesColors?: Record<string, string>;
  /** "top" matches the dashboard charts. Default "bottom" is today's. */
  legendPosition?: "top" | "bottom";
  /**
   * Horizontal anchor for a top legend. "right" frees the left of the legend's
   * row for a caller rendering its own content there. Default "center" is
   * today's behaviour.
   */
  legendAlign?: "center" | "right";
  /**
   * Axis names are the `aggregation (field)` / `unit (field)` labels. Surfaces
   * that already say what the axes are in their own chrome pass false.
   */
  showAxisNames?: boolean;
  /**
   * Plot insets, passed straight to ECharts. A pass-through rather than a named
   * preset: the useful values differ per surface (a dashboard grid cell and a
   * full-width card want different insets), and a preset would need a new name
   * every time one of them changed.
   */
  grid?: Record<string, number | string>;
  /**
   * Cap on drawn bar width in px. Omitted lets bars fill their band, which is
   * today's behaviour — and a defect on any wide container, since the band
   * scale divides plot width by category count with no ceiling.
   */
  barMaxWidth?: number;

  /**
   * Vertical reference lines at x-axis values — a published revision, a deploy,
   * an incident. `value` is in the x-axis's own units, so epoch milliseconds on
   * a time axis.
   *
   * Omitted draws none, which is what every existing caller gets. Attached to
   * one series only: ECharts would otherwise draw the same line once per
   * series, and a stacked chart with six groups would stack six identical
   * dashed lines on top of each other.
   */
  /**
   * Overrides the chart container's size. Omitted keeps the 350px floor and
   * 80% height every existing caller renders at.
   *
   * A prop rather than a CSS override at the call site: the size is set as an
   * inline style here, so a stylesheet could only win with `!important`, and
   * the component would go on claiming a 350px floor that was not true.
   */
  chartHeight?: { minHeight?: string; height?: string };

  /**
   * `yAxis.splitNumber` — roughly how many gridlines to aim for. Omitted leaves
   * ECharts' own choice, which is right for a full-height chart and too busy
   * for a short one.
   */
  yAxisSplitNumber?: number;

  /** Legend padding. Omitted keeps `[8, 0, 20, 0]`. */
  legendPadding?: number[];

  /**
   * Hides ECharts' own legend. For a caller rendering the legend outside the
   * canvas, where it costs no plot height. Omitted shows it, as every existing
   * caller does.
   */
  showLegend?: boolean;

  /**
   * Replaces the y-axis tick text. For a short plot, where a full-precision
   * number is wide enough to push the plot right for no gain. Omitted keeps the
   * shared `formatter`, which every existing caller uses.
   */
  yAxisLabelFormatter?: (value: number) => string;

  /**
   * Pushes a mark line's label off its endpoint. Negative moves it down, which
   * is how a label clears a legend band it would otherwise land in.
   *
   * A distance rather than a position because ECharts' `insideEnd*` positions
   * render nothing for a pixel-anchored mark line — verified — and because an
   * offset leaves the line's own overshoot intact, so the line still guarantees
   * a visible segment under a tall bar.
   */
  markLineLabelDistance?: number;

  markLines?: {
    value: number;
    label?: string;
    /**
     * Which way the label extends from its line. Omitted centres it, which is
     * right anywhere but the edges; "right" makes it run leftward and "left"
     * rightward, so a marker near a plot edge keeps its text inside.
     */
    align?: "left" | "right";
  }[];

  /**
   * The currently selected bar, in DATA terms — `x` is the bucket's x-axis
   * value and `group` the series it was clicked in, absent for a click on the
   * column background.
   *
   * Expressed this way rather than as ECharts indices so the caller never has
   * to know the internal series order or dataset row order; the translation
   * both ways is this component's job.
   *
   * Set: the selected bar keeps its colour and everything else dims. Null or
   * omitted: nothing dims, which is what every existing caller gets.
   *
   * `x` absent selects the whole SERIES named by `group` across every bucket,
   * for a caller that selects from a list rather than from a bar.
   */
  selection?: { x?: number; group?: string } | null;

  /**
   * Alpha applied to everything outside the selection. Defaults to 0.25, the
   * bar-selection dim, so existing callers are unchanged.
   */
  selectionDimOpacity?: number;

  /**
   * Fired when a bar is clicked. `group` is present for a segment and absent
   * for the column background. Never fired unless a handler is passed, so the
   * chart stays inert for callers that have no selection model.
   */
  onSelect?: (selection: { x: number; group?: string }) => void;

  /**
   * Pixels a mark line runs ABOVE the plot area, so it reads as annotating the
   * chart rather than as one more thing inside it.
   *
   * 0 or omitted keeps the default, which spans exactly the plot. Needs
   * `grid.top` as a number and `grid.bottom` as a percentage to resolve the two
   * ends; any other grid shape falls back to the plot-spanning line rather than
   * guessing at a height it cannot know before render.
   */
  markLineOvershoot?: number;
}) {
  const anchorYAxisToZero =
    "displaySettings" in dataVizConfig && dataVizConfig.displaySettings
      ? (dataVizConfig.displaySettings.anchorYAxisToZero ?? true)
      : true;
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
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";

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

  /**
   * Recessive by construction: the house grid-line colour for the rule itself,
   * and the axis label colour for the text, so a marker reads as chart
   * furniture rather than as data competing with the bars.
   *
   * `symbol: "none"` removes the arrowhead ECharts puts on a markLine by
   * default, which on a vertical rule points at nothing.
   */
  /**
   * A step darker than the grid lines — same black/white alpha construction the
   * chart theme uses, roughly double the opacity.
   *
   * At the grid value the rule was there but not findable: a dashed line at 6%
   * against stacked bars reads as a rendering artefact rather than as something
   * placed deliberately. This is the next step up that still sits behind the
   * data rather than beside it.
   */
  /**
   * The panel a chart sits on, for the mark-line label's text outline. Read
   * from the live CSS token rather than restated here, so it tracks the card
   * through theme changes and any future retheming. ECharts paints to
   * canvas/SVG and cannot take a `var()`, so it has to be resolved to a literal
   * at config time.
   */
  const markLineSurface = useMemo(() => {
    const fallback = theme === "dark" ? "#1c2339" : "#ffffff";
    if (typeof window === "undefined") return fallback;
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-panel-solid")
      .trim();
    return resolved || fallback;
  }, [theme]);

  const markLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.16)";

  /**
   * The two pixel anchors an overshooting line needs, or undefined when the
   * grid cannot supply them.
   *
   * `grid.bottom` is a percentage from the BOTTOM, so the line's lower end is
   * its complement from the top. Resolved as a percentage rather than a pixel
   * count so it keeps tracking the plot floor as the chart is resized.
   */
  const markLineOvershootAnchors = useMemo(() => {
    if (!markLineOvershoot) return undefined;
    const top = grid?.top;
    const bottom = grid?.bottom;
    if (typeof top !== "number") return undefined;
    if (typeof bottom !== "string" || !bottom.trim().endsWith("%")) {
      return undefined;
    }
    const fromBottom = parseFloat(bottom);
    if (!isFinite(fromBottom)) return undefined;
    return {
      top: top - markLineOvershoot,
      bottom: `${100 - fromBottom}%`,
    };
  }, [markLineOvershoot, grid?.top, grid?.bottom]);

  const markLineConfig = useMemo(() => {
    /**
     * One end of a mark line, or a whole plot-spanning one. Declared because
     * the two forms below — bare items and two-item pairs — would otherwise
     * infer as mutually exclusive array types and neither would accept the
     * other.
     */
    type MarkLineEntry = {
      xAxis: number;
      y?: number | string;
      label?: Record<string, unknown>;
    };

    if (!markLines?.length) return undefined;
    const overshoot = markLineOvershootAnchors;
    const themeColors = getChartThemeColors(theme);

    return {
      /**
       * BEHIND the bars, alongside the axis split lines rather than above the
       * data — which is where an annotation belongs relative to what it
       * annotates. A markLine defaults to z 5 and so outranks its own series
       * (z 2); 1 puts it under the bars while still clearing the split lines.
       *
       * Being hidden where it crosses a bar is the intended behaviour, not a
       * loss: the split lines already do exactly this, and the segment above
       * the plot is what guarantees the mark and its label stay readable no
       * matter how tall the bar underneath is. That is what `markLineOvershoot`
       * is for, and why the two go together.
       */
      z: 1,
      /**
       * Instant. A mark line is a reference, not a measurement — it has no
       * value to reveal, so animating it draws the eye to the annotation
       * instead of to the data it annotates.
       *
       * Set here rather than on the series: `markLine` extends
       * AnimationOptionMixin in its own right, so this turns off the line's
       * animation while the bars keep theirs.
       */
      animation: false,
      symbol: "none" as const,
      // The line is reference, not a data point — hovering it should not
      // preempt the tooltip for the bar behind it.
      silent: true,
      emphasis: { disabled: true },
      lineStyle: {
        type: "dashed" as const,
        width: 1,
        color: markLineColor,
      },
      label: {
        show: true,
        // Top of the plot: a vertical markLine runs bottom-to-top, so "end" is
        // the top edge, clear of the bars.
        position: "end" as const,
        color: themeColors.textColor,
        fontSize: 10,
        ...(markLineLabelDistance !== undefined
          ? { distance: markLineLabelDistance }
          : {}),
        // Keeps the text legible wherever it lands — over the legend band on a
        // tall chart, over the bars on a short one where it is pushed inside
        // the plot.
        textBorderColor: markLineSurface,
        textBorderWidth: 2,
      },
      /**
       * A line with no label is still a line. The caller decides which ones
       * earn text; see the labelling policy where these are built.
       */
      data: markLines.map<MarkLineEntry | MarkLineEntry[]>((m) => {
        const label = m.label
          ? { formatter: m.label, ...(m.align ? { align: m.align } : {}) }
          : { show: false };

        if (overshoot) {
          // Two explicit ends, so the line can leave the plot. Bottom FIRST:
          // `position: "end"` anchors the label to the second point, and the
          // label belongs at the top. Reversing these puts it under the bars.
          //
          // x stays a data coordinate while y is in pixels — ECharts resolves
          // the two dimensions independently, so the line tracks the time axis
          // exactly as the plot-spanning form does.
          return [
            { xAxis: m.value, y: overshoot.bottom },
            { xAxis: m.value, y: overshoot.top, label },
          ];
        }

        return { xAxis: m.value, label };
      }),
    };
  }, [
    markLines,
    theme,
    markLineColor,
    markLineSurface,
    markLineLabelDistance,
    markLineOvershootAnchors,
  ]);

  /**
   * Per-datum colour while a selection is live: the selected bar keeps its
   * colour, everything else drops to a quarter alpha.
   *
   * A colour callback rather than ECharts' `blur` state, which only reaches a
   * datum through `dispatchAction` — an imperative call that has to be kept in
   * step with React's render and re-fired after every option change. Returning
   * a colour is declarative: the dim IS the option, so it cannot drift from the
   * selection prop.
   *
   * `rgba()` rather than an 8-digit hex, which ECharts does not parse here.
   */
  /**
   * Whether this chart participates in selection at all.
   *
   * Drives the SHAPE of itemStyle, not just its value, and that matters: the
   * chart is keyed on `JSON.stringify(option)`, and JSON.stringify drops
   * function values. A colour that switched between a string and a callback as
   * a selection came and went would change the key, remount the whole chart,
   * and replay the entry animation — which is the flicker.
   *
   * Holding the callback form constant keeps the key stable across selection
   * changes, so ECharts updates in place and the dim arrives as its normal
   * update transition instead.
   */
  const selectable = typeof onSelect === "function";

  /**
   * Latest rows and callback, read by the click handlers at click time.
   *
   * echarts-for-react deep-compares `onEvents` after every update and, when it
   * differs, disposes the chart and builds a new one — replaying the entry
   * animation. An inline `{ click: () => … }` is a new function every render,
   * so any re-render (the sticky header toggling on scroll, the auto-refresh
   * poll) rebuilt the chart and flickered. The handlers below are created once
   * per `selectable` and reach current values through these refs instead of
   * closing over them. The same refs keep `onChartReady`'s background handler,
   * which is bound once per chart instance, from going stale.
   */
  const aggregatedRowsRef = useRef(aggregatedRows);
  aggregatedRowsRef.current = aggregatedRows;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /**
   * Segment clicks. ECharts reports these in its own terms — a series index and
   * a dataset row index — so they are translated back to the x value and the
   * group name before leaving this component.
   */
  const chartEvents = useMemo(
    () =>
      selectable
        ? {
            click: (params: {
              componentType?: string;
              dataIndex?: number;
              seriesName?: string;
            }) => {
              if (params.componentType !== "series") return;
              if (params.dataIndex === undefined) return;
              const row = aggregatedRowsRef.current[params.dataIndex] as
                | { x?: unknown }
                | undefined;
              const x =
                row?.x instanceof Date ? row.x.getTime() : Number(row?.x);
              if (!isFinite(x)) return;
              onSelectRef.current?.({ x, group: params.seriesName });
            },
          }
        : undefined,
    [selectable],
  );

  const dimmedColor = useCallback(
    (base: string, isSelected: boolean) => {
      if (!selection || isSelected) return base;
      // echarts' own helper, so any colour form the palette can produce —
      // hex, rgb(), a named colour — is handled the same way the library
      // handles it everywhere else.
      return echartsColor.modifyAlpha(base, selectionDimOpacity);
    },
    [selection, selectionDimOpacity],
  );

  /**
   * Whether a datum is the selected one. A background click carries no group,
   * so it selects the whole column and every series at that x stays lit.
   */
  const isSelectedDatum = useCallback(
    (dataIndex: number, seriesName: string) => {
      if (!selection) return false;
      // A series selection: every bucket of that series stays lit.
      if (selection.x === undefined) return selection.group === seriesName;
      const row = aggregatedRows[dataIndex] as { x?: unknown } | undefined;
      const x = row?.x instanceof Date ? row.x.getTime() : Number(row?.x);
      if (x !== selection.x) return false;
      return selection.group === undefined || selection.group === seriesName;
    },
    [selection, aggregatedRows],
  );

  const series = useMemo(() => {
    if (dimensionFields.length === 0) {
      return [
        {
          name: xField,
          ...CHART_ANIMATION_CONFIG,
          type:
            dataVizConfig.chartType === "area"
              ? "line"
              : dataVizConfig.chartType,
          ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
          ...(barMaxWidth !== undefined ? { barMaxWidth } : {}),
          ...(markLineConfig ? { markLine: markLineConfig } : {}),
          ...(selectable
            ? {
                itemStyle: {
                  color: (p: { dataIndex: number; color?: string }) =>
                    dimmedColor(
                      p.color ?? "",
                      isSelectedDatum(p.dataIndex, xField ?? ""),
                    ),
                },
              }
            : {}),
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

    return (
      dimensionCombinations
        .map((combination) => combination.join(", "))
        // Sorted by name, not by volume. The order was previously whatever the
        // upstream aggregation happened to produce, which is unstable when two
        // groups tie — the same data could render [true, false] on one load and
        // [false, true] on the next, moving both the colour and the stack
        // position. Name order is also stable as the data changes, which volume
        // order is not: on a chart that refreshes while you watch it, a segment
        // should not swap places because one group briefly overtook another.
        .sort((a, b) => a.localeCompare(b))
        .map((dimensionKey, seriesIndex) => ({
          name: dimensionKey,
          // First series only — see the note on the markLines prop.
          ...(markLineConfig && seriesIndex === 0
            ? { markLine: markLineConfig }
            : {}),
          ...CHART_ANIMATION_CONFIG,
          type:
            dataVizConfig.chartType === "area"
              ? "line"
              : dataVizConfig.chartType,
          ...(dataVizConfig.chartType === "area" && { areaStyle: {} }),
          stack: shouldStack ? "stack" : undefined,
          ...(barMaxWidth !== undefined ? { barMaxWidth } : {}),
          // A selection turns the flat colour into a per-datum one; without a
          // selection the static form is kept, so nothing changes for callers
          // that never select.
          // The callback form is used whenever this chart is selectable, even
          // with nothing selected — see `selectable` for why the shape has to
          // stay constant. Non-selectable callers keep the flat colour.
          ...(selectable
            ? {
                itemStyle: {
                  color: (p: { dataIndex: number; color?: string }) =>
                    dimmedColor(
                      seriesColors?.[dimensionKey] ?? p.color ?? "",
                      isSelectedDatum(p.dataIndex, dimensionKey),
                    ),
                },
              }
            : seriesColors?.[dimensionKey]
              ? { itemStyle: { color: seriesColors[dimensionKey] } }
              : {}),
          encode: {
            x: "x",
            y: dimensionKey,
          },
        }))
    );
  }, [
    dataVizConfig.chartType,
    xField,
    dimensionFields,
    dimensionValuesByField,
    dimensionConfigs,
    generateAllDimensionCombinations,
    seriesColors,
    barMaxWidth,
    markLineConfig,
    selectable,
    dimmedColor,
    isSelectedDatum,
  ]);

  /**
   * The palette, in series order — needed only because `itemStyle.color` is a
   * callback on a selectable chart.
   *
   * ECharts cannot resolve a legend swatch from a function, so it silently
   * falls back to its own default palette and the legend stops describing the
   * bars. Handing it `option.color` gives it a per-series colour it can read
   * without calling anything, while the bars keep taking theirs from the
   * callback — so the legend is right AND the dimming still works.
   *
   * Order matters: ECharts assigns the palette by series index, and the series
   * are sorted by name above, so this is built from the same sorted list.
   */
  const seriesPalette = useMemo(() => {
    if (!selectable || !seriesColors) return undefined;
    const names = (series as { name?: string }[])
      .map((sr) => sr.name)
      .filter((n): n is string => typeof n === "string");
    if (!names.length) return undefined;
    return names.map((n) => seriesColors[n]).filter(Boolean);
  }, [selectable, seriesColors, series]);

  const option = useMemo(() => {
    return {
      dataset,
      ...(seriesPalette?.length ? { color: seriesPalette } : {}),
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: {
          type: dataVizConfig?.chartType === "bar" ? "shadow" : "cross",
        },
        textStyle: { color: textColor },
        backgroundColor: tooltipBackgroundColor,
        // Matches the dashboard charts; ECharts' own default leaves the text
        // flush against the tooltip edge.
        padding: [10, 14],
        // Deliberately NOT the axis formatter: an axis abbreviates because it
        // is a scale, a tooltip states the value because it is the answer to
        // "what exactly is this bar".
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
              show: showLegend,
              textStyle: {
                color: textColor,
              },
              // Dashboard charts put the legend above the plot; "bottom" is
              // what every existing caller keeps.
              ...(legendPosition === "top"
                ? {
                    top: 8,
                    type: "plain",
                    padding: legendPadding ?? [8, 0, 20, 0],
                    // Anchoring right means omitting `width` entirely: given a
                    // width, ECharts centres within it and `right` is ignored.
                    //
                    // The inset comes from the grid when the caller supplied
                    // one, so the legend lines up with the plot's right edge
                    // rather than with the canvas edge.
                    ...(legendAlign === "right"
                      ? { right: grid?.right ?? 8 }
                      : { width: "88%" }),
                  }
                : { top: "bottom", type: "scroll" }),
            },
          }
        : null),
      ...(grid ? { grid } : {}),
      xAxis: {
        name: !showAxisNames
          ? ""
          : xConfig?.type === "date" && xConfig?.dateAggregationUnit !== "none"
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
        scale: !anchorYAxisToZero,
        type:
          xConfig?.type === "date"
            ? "time"
            : xConfig?.type === "number"
              ? "value"
              : "category",
      },
      yAxis: {
        scale: !anchorYAxisToZero,
        ...(yAxisSplitNumber !== undefined
          ? { splitNumber: yAxisSplitNumber }
          : {}),
        // The house grid line, imported rather than restated — a copy is how
        // VelocityBlockChart drifted from it.
        splitLine: {
          lineStyle: { color: getChartThemeColors(theme).gridLineColor },
        },
        name: !showAxisNames
          ? ""
          : yConfig?.aggregation && yConfig?.aggregation !== "none"
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
          ...(yAxisLabelFormatter
            ? { formatter: (value: number) => yAxisLabelFormatter(value) }
            : {}),
        },
      },
      series,
    };
  }, [
    dataset,
    seriesPalette,
    yAxisSplitNumber,
    yAxisLabelFormatter,
    legendPadding,
    showLegend,
    dataVizConfig?.chartType,
    dataVizConfig.title,
    textColor,
    tooltipBackgroundColor,
    dimensionFields.length,
    xConfig?.type,
    xConfig?.dateAggregationUnit,
    xField,
    anchorYAxisToZero,
    yConfig?.aggregation,
    yConfig?.type,
    legendPosition,
    legendAlign,
    showAxisNames,
    grid,
    theme,
    yField,
    series,
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
          style={{
            width: "100%",
            minHeight: chartHeight?.minHeight ?? "350px",
            height: chartHeight?.height ?? "80%",
          }}
          onEvents={chartEvents}
          onChartReady={(chart) => {
            /**
             * Column-background clicks, which are not series events and so
             * never reach `onEvents`. zrender leaves `target` undefined when a
             * click lands on blank canvas rather than on a rendered element —
             * that absence IS the test for "background".
             *
             * Deliberately paired with leaving `showBackground` off: turning it
             * on would make each column a real element, which would set
             * `target` and collapse the distinction these two channels exist to
             * draw.
             */
            if (onSelect) {
              chart
                .getZr()
                .on(
                  "click",
                  (e: {
                    target?: unknown;
                    offsetX: number;
                    offsetY: number;
                  }) => {
                    if (e.target) return;
                    const point = [e.offsetX, e.offsetY];
                    if (!chart.containPixel("grid", point)) return;
                    const [x] = chart.convertFromPixel(
                      { seriesIndex: 0 },
                      point,
                    );
                    if (!isFinite(x)) return;
                    // Snap to the bucket the click fell in: the pixel maps to an
                    // arbitrary instant, and a selection has to name a bucket.
                    let nearest: number | null = null;
                    aggregatedRowsRef.current.forEach((r) => {
                      const rowX =
                        (r as { x?: unknown }).x instanceof Date
                          ? (r as { x: Date }).x.getTime()
                          : Number((r as { x?: unknown }).x);
                      if (!isFinite(rowX) || rowX > x) return;
                      if (nearest === null || rowX > nearest) nearest = rowX;
                    });
                    if (nearest === null) return;
                    onSelectRef.current?.({ x: nearest });
                  },
                );
            }
            // TEMPORARY INSTRUMENTATION — remove before landing anything.
            // Captures the real ECharts option for the DataVisualizationDisplay
            // vs ExplorerChart comparison. dataset/aria/axisPointer are dropped
            // because the inline dataset.source clips the console before the
            // appearance properties.
            {
              const { dataset, aria, axisPointer, ...rest } = chart.getOption();
              void dataset;
              void aria;
              void axisPointer;
              console.log(
                "ECHARTS_OPTION DataVisualizationDisplay",
                JSON.stringify(rest),
              );
            }
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
