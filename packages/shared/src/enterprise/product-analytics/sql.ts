import { getValidDate } from "shared/dates";
import { format } from "shared/sql";
import { SqlHelpers } from "shared/types/sql";
import {
  RowFilter,
  FactTableInterface,
  FactTableMap,
  FactMetricInterface,
  ColumnInterface,
  FactTableColumnType,
  MetricCappingSettings,
  NumberFormat,
  ColumnRef,
} from "shared/types/fact-table";
import { DataSourceSettings } from "shared/types/datasource";
import {
  ProductAnalyticsDimension,
  ProductAnalyticsDynamicDimension,
  FactTableDataset,
  ProductAnalyticsConfig,
  DatabaseDataset,
  ProductAnalyticsResult,
  ProductAnalyticsResultRow,
} from "../../validators/product-analytics";
import {
  getRowFilterSQL,
  getColumnExpression,
  getAggregateFilters,
} from "../../experiments";

// Internal Type definitions
type MinimalFactTable = Pick<
  FactTableInterface,
  "sql" | "columns" | "filters" | "userIdTypes" | "timestampColumn"
>;
type MinimalMetric = Pick<
  FactMetricInterface,
  | "id"
  | "name"
  | "metricType"
  | "numerator"
  | "denominator"
  | "cappingSettings"
  | "windowSettings"
  | "quantileSettings"
>;
interface MinimalDatasourceInterface {
  settings?: DataSourceSettings | null;
}
interface MetricWithMetadata {
  metric: MinimalMetric;
  unit?: string;
  index: number;
  useDenominator?: boolean;
}
interface FactTableGroup {
  index: number;
  factTable: MinimalFactTable;
  metrics: MetricWithMetadata[];
  units: string[];
}
interface MetricData {
  unit: string | null;
  alias: string;
  percentileCapValueExpr: string | null;
  eventValueExpr: string;
  unitAggregationExpr: string | null;
  rollupAggregationExpr: string;
  rollupCountExpr: string | null;
}
interface DimensionData {
  alias: string;
  valueExpr: string;
}
interface CTE {
  name: string;
  sql: string;
}
interface DateRange {
  startDate: Date;
  endDate: Date;
}

function getMetricAliases(index: number) {
  return {
    base: `m${index}`,
    numerator: `m${index}_numerator`,
    denominator: `m${index}_denominator`,
  };
}

// Helpers to convert to internal types
function getMetricsAndUnitsFromValues(
  values: FactTableDataset["values"] | DatabaseDataset["values"],
): { metrics: MetricWithMetadata[]; units: string[] } {
  const units = new Set<string>();

  const metrics: MetricWithMetadata[] = [];
  let index = 0;
  for (const value of values) {
    const metric = createSimpleMetric(
      value.valueType,
      value.valueColumn,
      value.rowFilters,
      value.name,
    );
    metrics.push({
      metric,
      index: index++,
      unit: value.unit || undefined,
    });

    if (value.unit) {
      units.add(value.unit);
    }
  }

  return { metrics, units: Array.from(units) };
}
function getFactTableGroups({
  config,
  factTableMap,
  metricMap,
  datasourceSettings,
}: {
  config: ProductAnalyticsConfig;
  factTableMap: FactTableMap;
  metricMap: Map<string, FactMetricInterface>;
  datasourceSettings: DataSourceSettings | null;
}): FactTableGroup[] {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  switch (config.dataset.type) {
    case "data_source":
      return [
        {
          index: 0,
          factTable: createStubFactTable(
            `SELECT * FROM ${config.dataset.path}`,
            config.dataset.timestampColumn,
            config.dataset.columnTypes,
            datasourceSettings,
          ),
          ...getMetricsAndUnitsFromValues(config.dataset.values),
        },
      ];
    case "fact_table":
      return (() => {
        if (!config.dataset.factTableId) {
          throw new Error("Fact table ID is required");
        }
        const factTable = factTableMap.get(config.dataset.factTableId);
        if (!factTable) {
          throw new Error(`Fact table ${config.dataset.factTableId} not found`);
        }
        return [
          {
            index: 0,
            factTable,
            ...getMetricsAndUnitsFromValues(config.dataset.values),
          },
        ];
      })();
    case "metric":
      return (() => {
        const groups: Record<string, FactTableGroup> = {};
        let metricIndex = 0;
        for (const value of config.dataset.values) {
          const originalMetric = metricMap.get(value.metricId);
          if (!originalMetric) {
            throw new Error(`Metric ${value.metricId} not found`);
          }

          const metric: MinimalMetric = {
            id: originalMetric.id,
            name: originalMetric.name,
            metricType: originalMetric.metricType,
            cappingSettings: originalMetric.cappingSettings,
            windowSettings: originalMetric.windowSettings,
            quantileSettings: originalMetric.quantileSettings,
            numerator: {
              ...originalMetric.numerator,
              rowFilters: [
                ...(originalMetric.numerator.rowFilters || []),
                ...(value.rowFilters || []),
              ],
            },
            denominator: originalMetric.denominator
              ? {
                  ...originalMetric.denominator,
                  rowFilters: [
                    ...(originalMetric.denominator.rowFilters || []),
                    ...(value.rowFilters || []),
                  ],
                }
              : null,
          };

          const factTable = factTableMap.get(metric.numerator.factTableId);
          if (!factTable) {
            throw new Error(
              `Fact table ${metric.numerator.factTableId} not found`,
            );
          }
          if (!groups[factTable.id]) {
            groups[factTable.id] = {
              index: Object.keys(groups).length,
              factTable,
              metrics: [],
              units: [],
            };
          }
          const group = groups[factTable.id];
          group.metrics.push({
            index: metricIndex,
            metric,
            unit: value.unit || undefined,
          });
          if (value.unit && !group.units.includes(value.unit)) {
            group.units.push(value.unit);
          }

          if (metric.metricType === "ratio" && metric.denominator) {
            const denominatorFactTable = factTableMap.get(
              metric.denominator.factTableId,
            );
            if (!denominatorFactTable) {
              throw new Error(
                `Fact table ${metric.denominator.factTableId} not found`,
              );
            }
            if (!groups[denominatorFactTable.id]) {
              groups[denominatorFactTable.id] = {
                index: Object.keys(groups).length,
                factTable: denominatorFactTable,
                metrics: [],
                units: [],
              };
            }
            const denominatorGroup = groups[denominatorFactTable.id];
            denominatorGroup.metrics.push({
              index: metricIndex,
              metric,
              unit: value.denominatorUnit || undefined,
              useDenominator: true,
            });
            if (
              value.denominatorUnit &&
              !denominatorGroup.units.includes(value.denominatorUnit)
            ) {
              denominatorGroup.units.push(value.denominatorUnit);
            }
          }
          metricIndex++;
        }
        return Object.values(groups);
      })();
  }
}
export function calculateProductAnalyticsDateRange(
  dateRange: ProductAnalyticsConfig["dateRange"],
): DateRange {
  const startDate = new Date();
  const endDate = new Date();

  switch (dateRange.predefined) {
    case "today":
      startDate.setUTCHours(0, 0, 0, 0);
      return { startDate, endDate };
    case "last7Days":
      startDate.setUTCDate(startDate.getUTCDate() - 7);
      return { startDate, endDate };
    case "last30Days":
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      return { startDate, endDate };
    case "last90Days":
      startDate.setUTCDate(startDate.getUTCDate() - 90);
      return { startDate, endDate };
    case "customLookback":
      if (dateRange.lookbackValue && dateRange.lookbackUnit) {
        const unit = dateRange.lookbackUnit;
        const value = dateRange.lookbackValue;
        if (unit === "hour") {
          startDate.setUTCHours(startDate.getUTCHours() - value);
        } else if (unit === "day") {
          startDate.setUTCDate(startDate.getUTCDate() - value);
        } else if (unit === "week") {
          startDate.setUTCDate(startDate.getUTCDate() - value * 7);
        } else if (unit === "month") {
          startDate.setUTCMonth(startDate.getUTCMonth() - value);
        }
      } else {
        startDate.setUTCDate(startDate.getUTCDate() - 30);
      }
      return { startDate, endDate };
    case "customDateRange":
      return {
        startDate: getValidDate(dateRange.startDate),
        endDate: getValidDate(dateRange.endDate),
      };
  }
}

// Get date granularity
export function getDateGranularity(
  granularity: "auto" | "hour" | "day" | "week" | "month" | "year",
  dateRange: DateRange,
): "hour" | "day" | "week" | "month" | "year" {
  // Calculate number of days between start and end date
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffTime = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const days = diffTime / msPerDay;

  // If explicit granularity is valid for the date range, return it
  if (granularity === "hour" && days <= 8) return "hour";
  if (granularity === "day" && days <= 94) return "day";
  if (granularity === "week" && days <= 365) return "week";
  if (granularity === "month") return "month";
  if (granularity === "year") return "year";

  // Fall back to auto granularity
  if (days < 3) return "hour";
  if (days < 63) return "day";
  return "month";
}

// Generate row filter SQL
function generateRowFilterSQL(
  rowFilters: RowFilter[],
  factTable: MinimalFactTable,
  helpers: SqlHelpers,
): string[] {
  if (!rowFilters.length) {
    return [];
  }

  return rowFilters
    .map((filter) => {
      const sql = getRowFilterSQL({
        rowFilter: filter,
        factTable,
        escapeStringLiteral: helpers.escapeStringLiteral,
        jsonExtract: helpers.jsonExtract,
        evalBoolean: helpers.evalBoolean,
      });
      return sql;
    })
    .filter((sql): sql is string => sql !== null);
}

function getCappingSettings(
  metric: MinimalMetric,
): MetricCappingSettings | null {
  if (metric.metricType === "proportion") return null;

  if (
    metric.cappingSettings?.type === "percentile" ||
    metric.cappingSettings?.type === "absolute"
  ) {
    return metric.cappingSettings;
  }

  return null;
}

// Generate dimension expression
function generateDimensionExpression(
  dimension: ProductAnalyticsDimension,
  dimensionIndex: number,
  factTableGroup: FactTableGroup,
  helpers: SqlHelpers,
  dateRange: DateRange,
): string {
  const factTable = factTableGroup.factTable;
  switch (dimension.dimensionType) {
    case "date": {
      const granularity = getDateGranularity(
        dimension.dateGranularity,
        dateRange,
      );
      return `${helpers.dateTrunc(
        factTable.timestampColumn || "timestamp",
        granularity,
      )}`;
    }
    case "dynamic": {
      const topCTE = `_dimension${dimensionIndex}_top`;
      const columnExpr = getColumnExpression(
        dimension.column,
        factTable,
        helpers.jsonExtract,
      );
      return `CASE 
        WHEN ${columnExpr} IN (SELECT value FROM ${topCTE}) THEN ${columnExpr}
        ELSE 'other'
      END`;
    }
    case "static": {
      const columnExpr = getColumnExpression(
        dimension.column,
        factTable,
        helpers.jsonExtract,
      );
      const valueList = dimension.values
        .map((v) => `'${helpers.escapeStringLiteral(v)}'`)
        .join(", ");
      return `CASE 
        WHEN ${columnExpr} IN (${valueList}) THEN ${columnExpr}
        ELSE 'other'
      END`;
    }
    case "slice": {
      const cases = dimension.slices.map(
        (slice) =>
          `WHEN (${generateRowFilterSQL(slice.filters, factTable, helpers).join(" AND ")}) THEN '${helpers.escapeStringLiteral(slice.name)}'`,
      );
      return `CASE
        ${cases.join("\n  ")}
        ELSE 'other'
      END`;
    }
  }
}

// Helper to create minimal FactMetricInterface for simple values
function createSimpleMetric(
  valueType: "count" | "sum" | "unit_count",
  valueColumn: string | null,
  rowFilters: RowFilter[],
  name: string,
): MinimalMetric {
  // Determine metric type and column based on valueType
  let metricType: "mean" | "proportion" = "mean";
  let column: string = valueColumn || "$$count";
  const aggregation: "sum" | "max" | "count distinct" = "sum";

  if (valueType === "unit_count") {
    metricType = "proportion";
    column = "$$distinctUsers";
  } else if (valueType === "count") {
    column = "$$count";
  } else if (valueColumn) {
    column = valueColumn;
  }

  const numerator: ColumnRef = {
    factTableId: "factTable",
    column,
    aggregation,
    rowFilters,
  };

  return {
    id: `simple_${name}_${Date.now()}`,
    name,
    metricType,
    numerator,
    denominator: null,
    cappingSettings: {
      type: "",
      value: 0,
      ignoreZeros: false,
    },
    windowSettings: {
      type: "",
      delayUnit: "days",
      delayValue: 0,
      windowUnit: "days",
      windowValue: 0,
    },
    quantileSettings: null,
  };
}

function getEventValueExpr(
  columnRef: ColumnRef,
  factTable: MinimalFactTable,
  helpers: SqlHelpers,
  alias: string,
  cap: MetricCappingSettings | null,
): string {
  let rawValue: string;
  if (columnRef.column === "$$distinctUsers") {
    if (columnRef.aggregateFilter && columnRef.aggregateFilterColumn) {
      rawValue = columnRef.aggregateFilterColumn;
    } else {
      rawValue = "1";
    }
  } else if (columnRef.column === "$$count") {
    rawValue = "1";
  } else if (columnRef.column === "$$distinctDates") {
    rawValue = helpers.dateTrunc(
      factTable.timestampColumn || "timestamp",
      "day",
    );
  } else {
    rawValue = columnRef.column;
  }

  if (cap) {
    if (cap.type === "percentile") {
      rawValue = `LEAST(${rawValue}, COALESCE(${alias}_cap, ${rawValue}))`;
    } else if (cap.type === "absolute") {
      rawValue = `LEAST(${rawValue}, ${cap.value})`;
    }
  }

  const filters = generateRowFilterSQL(
    columnRef.rowFilters || [],
    factTable,
    helpers,
  );
  if (!filters.length) {
    return rawValue;
  }

  return `CASE WHEN (${filters.join(" AND ")}) THEN ${rawValue} ELSE NULL END`;
}

function getUnitAggregationExpr(columnRef: ColumnRef, alias: string): string {
  if (columnRef.column === "$$distintDates") {
    return `COUNT(DISTINCT ${alias})`;
  } else if (columnRef.column === "$$distinctUsers") {
    if (columnRef.aggregateFilter && columnRef.aggregateFilterColumn) {
      const filters = getAggregateFilters({
        columnRef: columnRef,
        column: `SUM(${alias})`,
        ignoreInvalid: true,
      });
      if (filters.length > 0) {
        return `CASE WHEN (${filters.join(" AND ")}) THEN 1 ELSE NULL END as ${alias}`;
      }
    }
    return `MAX(${alias})`;
  } else if (columnRef.column === "$$count") {
    return `SUM(${alias})`;
  } else if (columnRef.aggregation === "count distinct") {
    return `COUNT(DISTINCT ${alias})`;
  } else if (columnRef.aggregation === "max") {
    return `MAX(${alias})`;
  } else {
    return `SUM(${alias})`;
  }
}

function getRollupAggregationExpr(
  metric: MinimalMetric,
  alias: string,
  helpers: SqlHelpers,
): string {
  // Quantiles
  if (metric.metricType === "quantile" && metric.quantileSettings) {
    return helpers.percentileApprox(alias, metric.quantileSettings.quantile);
  } else {
    return `SUM(${alias})`;
  }
}

function getRollupCountExpr(metric: MinimalMetric, alias: string): string {
  // Skip count for ratio metrics
  if (metric.metricType === "ratio") return "";
  return `COUNT(${alias})`;
}

// Generate metric value expression from metric with metadata
function getMetricData(
  metricWithMetadata: MetricWithMetadata,
  factTable: MinimalFactTable,
  helpers: SqlHelpers,
): MetricData {
  const {
    index: metricIndex,
    metric,
    unit,
    useDenominator,
  } = metricWithMetadata;
  const columnRef = useDenominator ? metric.denominator : metric.numerator;

  if (!columnRef) {
    throw new Error(`Column ref not found for metric ${metric.id}`);
  }

  const aliases = getMetricAliases(metricIndex);
  const alias = useDenominator ? aliases.denominator : aliases.base;

  const skipUnitAggregation =
    metric.metricType === "quantile" &&
    metric.quantileSettings?.type === "event";

  const requiresUnitAggregation =
    columnRef.aggregation === "max" ||
    columnRef.aggregation === "count distinct" ||
    metric.metricType === "dailyParticipation" ||
    metric.metricType === "proportion" ||
    columnRef.column === "$$distinctUsers" ||
    columnRef.column === "$$distinctDates";

  let selectedUnit = skipUnitAggregation ? null : unit || null;

  // Make sure selected unit is in the fact table user id types
  // Some metrics (like sum), we can fall back to event level aggregation instead
  if (selectedUnit && !factTable.userIdTypes.includes(selectedUnit)) {
    if (!requiresUnitAggregation) {
      selectedUnit = null;
    } else {
      throw new Error(
        `Selected unit ${selectedUnit} is not in the fact table user id types`,
      );
    }
  }

  // For mean metrics, we need to count the units to calculate the average
  let rollupCountExpr: string | null = null;
  if (metric.metricType === "mean" && selectedUnit) {
    rollupCountExpr = getRollupCountExpr(metric, alias);
  }

  const cappingSettings = getCappingSettings(metric);

  return {
    unit: selectedUnit,
    alias,
    percentileCapValueExpr:
      cappingSettings && cappingSettings.type === "percentile"
        ? getEventValueExpr(columnRef, factTable, helpers, alias, null)
        : null,
    eventValueExpr: getEventValueExpr(
      columnRef,
      factTable,
      helpers,
      alias,
      cappingSettings,
    ),
    unitAggregationExpr: selectedUnit
      ? getUnitAggregationExpr(columnRef, alias)
      : null,
    rollupAggregationExpr: getRollupAggregationExpr(metric, alias, helpers),
    rollupCountExpr,
  };
}

// Create a stub fact table from SQL dataset column types
function createStubFactTable(
  sql: string,
  timestampColumn: string,
  columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  >,
  datasourceSettings: DataSourceSettings | null,
): MinimalFactTable {
  const columns: ColumnInterface[] = Object.entries(columnTypes).map(
    ([column, datatype]) => ({
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: column,
      description: "",
      column,
      datatype: datatype as FactTableColumnType,
      numberFormat: "" as NumberFormat,
      deleted: false,
    }),
  );

  // Get available column names
  const columnNames = new Set(Object.keys(columnTypes));

  // Get userIdTypes from datasource settings and intersect with available columns
  let userIdTypes: string[] = []; // Default fallback
  if (datasourceSettings?.userIdTypes) {
    // Extract userIdType strings and filter to only those that exist in columns
    userIdTypes = datasourceSettings.userIdTypes
      .map((ut) => ut.userIdType)
      .filter((userIdType) => columnNames.has(userIdType));

    // If intersection is empty, fall back to default
    if (userIdTypes.length === 0) {
      userIdTypes = [];
    }
  }

  return {
    sql,
    columns,
    userIdTypes,
    timestampColumn,
    filters: [],
  };
}

// Generate dynamic dimension CTE
function generateDynamicDimensionCTE(
  factTableGroup: FactTableGroup,
  dimension: ProductAnalyticsDynamicDimension,
  dimensionIndex: number,
  sourceCTE: CTE,
  helpers: SqlHelpers,
): CTE {
  const cteName = `_dimension${dimensionIndex}_top`;

  const columnExpr = getColumnExpression(
    dimension.column,
    factTableGroup.factTable,
    helpers.jsonExtract,
  );

  return {
    name: cteName,
    sql: `
    SELECT ${columnExpr} as value
    FROM ${sourceCTE.name}
    GROUP BY ${columnExpr}
    ORDER BY COUNT(*) DESC
    LIMIT ${dimension.maxValues}
  `,
  };
}

function generatePercentileCapsCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  helpers: SqlHelpers,
): CTE | null {
  const selects: string[] = [];
  factTableGroup.metrics.forEach((m) => {
    const cappingSettings = getCappingSettings(m.metric);
    if (!cappingSettings || cappingSettings.type !== "percentile") return;

    const metricData = getMetricData(m, factTableGroup.factTable, helpers);

    selects.push(
      `${helpers.percentileApprox(
        metricData.percentileCapValueExpr || "NULL",
        cappingSettings.value,
      )} AS ${metricData.alias}_cap`,
    );
  });

  if (!selects.length) return null;

  return {
    name: `_factTable${factTableGroup.index}_percentile_caps`,
    sql: `SELECT 
      ${selects.join(",\n  ")}
    FROM ${sourceCTE.name}`,
  };
}

// Generate fact table group CTE
function generateFactTableCTE(
  factTableGroup: FactTableGroup,
  helpers: SqlHelpers,
  dateRange: DateRange,
): CTE {
  const factTable = factTableGroup.factTable;

  const timestampColumn = factTable.timestampColumn || "timestamp";

  const baseSql = factTable.sql;

  // Get a de-duped list of all filters across all metrics
  const filters = new Set<string>();
  factTableGroup.metrics.forEach((m) => {
    const columnRef = m.useDenominator
      ? m.metric.denominator
      : m.metric.numerator;

    if (!columnRef) return;

    const filterParts = generateRowFilterSQL(
      columnRef.rowFilters || [],
      factTable,
      helpers,
    );
    if (!filterParts.length) return;

    filterParts.sort();
    filters.add(`(${filterParts.join(" AND ")})`);
  });

  const whereClauses: string[] = [];

  // Date range filter
  whereClauses.push(
    `${timestampColumn} >= ${helpers.toTimestamp(dateRange.startDate)} AND ${timestampColumn} <= ${helpers.toTimestamp(dateRange.endDate)}`,
  );

  if (filters.size) {
    whereClauses.push(`(${Array.from(filters).join(" OR ")})`);
  }

  return {
    name: `_factTable${factTableGroup.index}`,
    sql: `
    SELECT * FROM (
      -- Raw fact table SQL
      ${baseSql}
    ) t
    WHERE 
      ${whereClauses.join("\n  AND ")}
  `,
  };
}

function generateFactTableRowsCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  percentileCapsCTE: CTE | null,
  dimensions: DimensionData[],
  helpers: SqlHelpers,
): CTE {
  const selectCols: string[] = [];

  // Select all dimension columns
  dimensions.forEach((d) => {
    selectCols.push(`${d.valueExpr} AS ${d.alias}`);
  });

  // Select all units
  factTableGroup.units.forEach((unit, i) => {
    selectCols.push(`${unit} AS unit${i}`);
  });

  // Select all metric event values
  factTableGroup.metrics.forEach((m) => {
    const metricData = getMetricData(m, factTableGroup.factTable, helpers);
    selectCols.push(`${metricData.eventValueExpr} AS ${metricData.alias}`);
  });

  return {
    name: `_factTable${factTableGroup.index}_rows`,
    sql: `
    SELECT
      ${selectCols.join(",\n  ")}
    FROM ${sourceCTE.name}
    ${percentileCapsCTE ? `CROSS JOIN ${percentileCapsCTE.name}` : ""}
  `,
  };
}

function generateUnitAggregationCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  dimensions: DimensionData[],
  unitIndex: number,
  includedMetrics: MetricData[],
): CTE {
  const selects: string[] = [];
  const groupBys: string[] = [];

  selects.push(`unit${unitIndex}`);
  groupBys.push(`unit${unitIndex}`);

  // Add dimensions
  dimensions.forEach((d) => {
    selects.push(`${d.alias}`);
    groupBys.push(`${d.alias}`);
  });

  // Add metrics
  includedMetrics.forEach((metricData) => {
    selects.push(
      `${metricData.unitAggregationExpr || "NULL"} AS ${metricData.alias}`,
    );
  });

  return {
    name: `_factTable${factTableGroup.index}_unit${unitIndex}`,
    sql: `
    SELECT 
      ${selects.join(",\n  ")}
    FROM ${sourceCTE.name}
    GROUP BY ${groupBys.join(", ")}
  `,
  };
}

function generateUnitAggregationRollupCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  dimensions: DimensionData[],
  unitIndex: number,
  includedMetrics: MetricData[],
  allMetrics: string[],
): CTE {
  const selects: string[] = [];
  const groupBys: string[] = [];

  // Add dimensions
  dimensions.forEach((d) => {
    selects.push(`${d.alias}`);
    groupBys.push(`${d.alias}`);
  });

  // Add metrics
  allMetrics.forEach((alias) => {
    const metricData = includedMetrics.find((m) => m.alias === alias);

    if (metricData && metricData.rollupAggregationExpr) {
      selects.push(
        `${metricData.rollupAggregationExpr || "NULL"} AS ${alias}_numerator`,
      );
      if (metricData.rollupCountExpr) {
        selects.push(`${metricData.rollupCountExpr} AS ${alias}_denominator`);
      }
    } else {
      selects.push(`NULL as ${alias}_numerator`);
      if (metricData?.rollupCountExpr) {
        selects.push(`NULL as ${alias}_denominator`);
      }
    }
  });

  return {
    name: `_factTable${factTableGroup.index}_unit${unitIndex}_rollup`,
    sql: `
    SELECT
      ${selects.join(",\n  ")}
    FROM ${sourceCTE.name}
    ${groupBys.length ? `GROUP BY ${groupBys.join(", ")}` : ""}
  `,
  };
}

function generateEventRollupCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  dimensions: DimensionData[],
  includedMetrics: MetricData[],
  allMetrics: string[],
): CTE {
  const selects: string[] = [];
  const groupBys: string[] = [];

  // Add dimensions
  dimensions.forEach((d) => {
    selects.push(`${d.alias}`);
    groupBys.push(`${d.alias}`);
  });

  // Add metrics
  allMetrics.forEach((alias) => {
    const metricData = includedMetrics.find((m) => m.alias === alias);
    if (metricData && metricData.rollupAggregationExpr) {
      selects.push(
        `${metricData.rollupAggregationExpr || "NULL"} AS ${metricData.alias}_numerator`,
      );
      if (metricData.rollupCountExpr) {
        selects.push(`${metricData.rollupCountExpr} AS ${alias}_denominator`);
      }
    } else {
      selects.push(`NULL as ${alias}_numerator`);
      if (metricData?.rollupCountExpr) {
        selects.push(`NULL as ${alias}_denominator`);
      }
    }
  });

  return {
    name: `_factTable${factTableGroup.index}_event_rollup`,
    sql: `
    SELECT
      ${selects.join(",\n  ")}
    FROM ${sourceCTE.name}
    ${groupBys.length ? `GROUP BY ${groupBys.join(", ")}` : ""}
  `,
  };
}

function generateCombinedRollupCTE(rollupCTEs: CTE[]): CTE {
  return {
    name: `_combined_rollup`,
    sql: rollupCTEs.map((r) => `SELECT * FROM ${r.name}`).join("\nUNION ALL\n"),
  };
}

function generateFinalSelect(
  combinedRollupCTE: CTE,
  dimensions: DimensionData[],
  allMetrics: MetricData[],
  needsReaggregation: boolean,
): string {
  const selects: string[] = [];
  const groupBys: string[] = [];
  dimensions.forEach((d) => {
    selects.push(`${d.alias}`);
    if (needsReaggregation) {
      groupBys.push(`${d.alias}`);
    }
  });
  allMetrics.forEach((m) => {
    selects.push(
      needsReaggregation
        ? `MAX(${m.alias}_numerator) AS ${m.alias}_numerator`
        : `${m.alias}_numerator AS ${m.alias}_numerator`,
    );
    if (m.rollupCountExpr) {
      selects.push(
        needsReaggregation
          ? `MAX(${m.alias}_denominator) AS ${m.alias}_denominator`
          : `${m.alias}_denominator AS ${m.alias}_denominator`,
      );
    }
  });
  return `
  SELECT ${selects.join(", ")} 
  FROM ${combinedRollupCTE.name}
  ${groupBys.length ? `GROUP BY ${groupBys.join(", ")}` : ""}`;
}

export function generateProductAnalyticsSQL(
  config: ProductAnalyticsConfig,
  factTableMap: FactTableMap,
  metricMap: Map<string, FactMetricInterface>,
  sqlHelpers: SqlHelpers,
  datasource: MinimalDatasourceInterface,
): {
  sql: string;
  orderedMetricIds: string[];
} {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  const factTableGroups = getFactTableGroups({
    config,
    factTableMap,
    metricMap,
    datasourceSettings: datasource.settings || null,
  });

  // Get all metric aliases
  const allMetrics: MetricData[] = [];
  const orderedMetricIds: string[] = [];
  factTableGroups.forEach((f) => {
    f.metrics.forEach((m) => {
      const data = getMetricData(m, f.factTable, sqlHelpers);
      allMetrics.push(data);
      // For ratio metrics, we only need to add the numerator since it's the same metric id
      if (!m.useDenominator) orderedMetricIds.push(m.metric.id);
    });
  });

  const allMetricsAliases: string[] = allMetrics.map((m) => m.alias);

  // Get all dimensions
  const allDimensions: DimensionData[] = [];
  config.dimensions.forEach((d, i) => {
    allDimensions.push({
      alias: `dimension${i}`,
      valueExpr: generateDimensionExpression(
        d,
        i,
        factTableGroups[0],
        sqlHelpers,
        dateRange,
      ),
    });
  });

  const ctes: CTE[] = [];

  const ctesToRollup: CTE[] = [];

  factTableGroups.forEach((factTableGroup, i) => {
    // Add the raw fact table CTE
    const factTableCTE = generateFactTableCTE(
      factTableGroup,
      sqlHelpers,
      dateRange,
    );
    ctes.push(factTableCTE);

    // If this is the first fact table and there are dynamic dimensions, add CTEs
    if (i === 0) {
      config.dimensions.forEach((dimension, dimensionIndex) => {
        if (dimension.dimensionType === "dynamic") {
          const dynamicDimensionCTE = generateDynamicDimensionCTE(
            factTableGroup,
            dimension,
            dimensionIndex,
            factTableCTE,
            sqlHelpers,
          );
          ctes.push(dynamicDimensionCTE);
        }
      });
    }

    // If there are percentile caps, add the percentile caps CTE
    const percentileCapsCTE = generatePercentileCapsCTE(
      factTableGroup,
      factTableCTE,
      sqlHelpers,
    );
    if (percentileCapsCTE) ctes.push(percentileCapsCTE);

    // Add the fact table rows CTE
    const factTableRowsCTE = generateFactTableRowsCTE(
      factTableGroup,
      factTableCTE,
      percentileCapsCTE,
      allDimensions,
      sqlHelpers,
    );
    ctes.push(factTableRowsCTE);

    // Split metrics into unit/event groups
    const unitMetrics: Record<string, MetricData[]> = {};
    const eventMetrics: MetricData[] = [];
    factTableGroup.metrics.forEach((m) => {
      const metricData = getMetricData(m, factTableGroup.factTable, sqlHelpers);
      if (metricData.unit) {
        if (!unitMetrics[metricData.unit]) {
          unitMetrics[metricData.unit] = [];
        }
        unitMetrics[metricData.unit].push(metricData);
      } else {
        eventMetrics.push(metricData);
      }
    });

    // Add the unit aggregation CTEs
    Object.entries(unitMetrics).forEach(([unit, metrics]) => {
      const unitIndex = factTableGroup.units.indexOf(unit);
      if (unitIndex === -1) {
        throw new Error(`Unit ${unit} not found in fact table group`);
      }
      const unitAggregationCTE = generateUnitAggregationCTE(
        factTableGroup,
        factTableRowsCTE,
        allDimensions,
        unitIndex,
        metrics,
      );
      ctes.push(unitAggregationCTE);

      // Unit rollup
      const unitRollupCTE = generateUnitAggregationRollupCTE(
        factTableGroup,
        unitAggregationCTE,
        allDimensions,
        unitIndex,
        metrics,
        allMetricsAliases,
      );
      ctes.push(unitRollupCTE);
      ctesToRollup.push(unitRollupCTE);
    });

    // Event rollup
    if (eventMetrics.length) {
      const eventRollupCTE = generateEventRollupCTE(
        factTableGroup,
        factTableRowsCTE,
        allDimensions,
        eventMetrics,
        allMetricsAliases,
      );
      ctes.push(eventRollupCTE);
      ctesToRollup.push(eventRollupCTE);
    }
  });

  // Combine all rollup CTEs if there are multiple
  let finalSelectSource: CTE;
  let needsReaggregation = true;
  if (ctesToRollup.length > 1) {
    finalSelectSource = generateCombinedRollupCTE(ctesToRollup);
    ctes.push(finalSelectSource);
  } else {
    finalSelectSource = ctesToRollup[0];
    needsReaggregation = false;
  }

  // Final select
  const sql = format(
    `
  WITH 
    ${ctes.map((c) => `${c.name} AS (\n${c.sql}\n)`).join(",\n  ")}
  ${generateFinalSelect(finalSelectSource, allDimensions, allMetrics, needsReaggregation)}
  `,
    sqlHelpers.formatDialect,
  );

  return {
    sql,
    orderedMetricIds,
  };
}

function parseStringValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return null;
}
function parseNumberValue(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function transformProductAnalyticsRowsToResult(
  config: ProductAnalyticsConfig,
  rows: Record<string, unknown>[],
  orderedMetricIds: string[],
): ProductAnalyticsResult {
  // Raw rows should look like this:
  // { dimension0: "value0", m0: 1, m0_denominator: 1 }

  const result: ProductAnalyticsResult = {
    rows: [],
  };

  for (const row of rows) {
    const resultRow: ProductAnalyticsResultRow = {
      dimensions: [],
      values: [],
    };
    result.rows.push(resultRow);

    config.dimensions.forEach((d, i) => {
      const alias = `dimension${i}`;
      resultRow.dimensions.push(parseStringValue(row[alias]));
    });
    orderedMetricIds.forEach((metricId, index) => {
      const aliases = getMetricAliases(index);
      resultRow.values.push({
        metricId,
        numerator: parseNumberValue(row[aliases.numerator]),
        denominator: parseNumberValue(row[aliases.denominator]),
      });
    });
  }

  return result;
}
