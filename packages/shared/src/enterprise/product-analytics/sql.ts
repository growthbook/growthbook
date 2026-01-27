import { z } from "zod";
import {
  RowFilter,
  FactTableInterface,
  FactTableMap,
  FactMetricInterface,
  ColumnInterface,
  FactTableColumnType,
  NumberFormat,
  ColumnRef,
} from "shared/types/fact-table";
import { DataSourceSettings } from "shared/types/datasource";
import {
  productAnalyticsConfigValidator,
  sqlDatasetColumnResponseValidator,
} from "../../validators/product-analytics";
import {
  getRowFilterSQL,
  getColumnExpression,
  getAggregateFilters,
} from "../../experiments";
import {
  DEFAULT_WIN_RISK_THRESHOLD,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
} from "../../constants";

// Type definitions
export type ProductAnalyticsConfig = z.infer<
  typeof productAnalyticsConfigValidator
>;
export type SqlDatasetColumnResponse = z.infer<
  typeof sqlDatasetColumnResponseValidator
>;

// Metric with metadata (prefix and fact table index)
export interface MetricWithMetadata {
  metric: FactMetricInterface;
  prefix: string; // e.g. 'm0' or 'm0_denominator'
  factTableIndex: number;
  isDenominator?: boolean;
  unit?: string | null; // Unit column for unit-level aggregations
}

// SQL helper functions interface
export interface SqlHelpers {
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (column: string, granularity: string) => string;
  percentileApprox: (column: string, percentile: number) => string;
  least: (a: string, b: string) => string;
  coalesce: (...args: string[]) => string;
  toTimestamp: (date: Date) => string;
}

// Default SQL helpers (generic SQL)
const defaultSqlHelpers: SqlHelpers = {
  escapeStringLiteral: (s: string) => s.replace(/'/g, "''"),
  jsonExtract: (jsonCol: string, path: string, _isNumeric: boolean) => {
    // Generic JSON extraction - may need to be overridden for specific databases
    return `${jsonCol}->>'${path}'`;
  },
  evalBoolean: (col: string, value: boolean) => {
    return `${col} IS ${value ? "TRUE" : "FALSE"}`;
  },
  dateTrunc: (column: string, granularity: string) => {
    return `date_trunc(${column}, '${granularity}')`;
  },
  percentileApprox: (column: string, percentile: number) => {
    return `PERCENTILE_APPROX(${column}, ${percentile})`;
  },
  least: (a: string, b: string) => {
    return `LEAST(${a}, ${b})`;
  },
  coalesce: (...args: string[]) => {
    return `COALESCE(${args.join(", ")})`;
  },
  toTimestamp: (date: Date) => {
    return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
  },
};

// Calculate date range from config
function calculateDateRange(dateRange: ProductAnalyticsConfig["dateRange"]): {
  startDate: Date;
  endDate: Date;
} {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;

  switch (dateRange.predefined) {
    case "today":
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case "last7Days":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "last30Days":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "last90Days":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "customLookback":
      if (dateRange.lookbackValue && dateRange.lookbackUnit) {
        startDate = new Date(now);
        const unit = dateRange.lookbackUnit;
        const value = dateRange.lookbackValue;
        if (unit === "hour") {
          startDate.setHours(startDate.getHours() - value);
        } else if (unit === "day") {
          startDate.setDate(startDate.getDate() - value);
        } else if (unit === "week") {
          startDate.setDate(startDate.getDate() - value * 7);
        } else if (unit === "month") {
          startDate.setMonth(startDate.getMonth() - value);
        }
      } else {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
      }
      break;
    case "customDateRange":
      startDate = dateRange.startDate || new Date(now);
      endDate = dateRange.endDate || now;
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
  }

  return { startDate, endDate };
}

// Calculate number of days between two dates
function calculateDaysBetween(startDate: Date, endDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffTime = endDate.getTime() - startDate.getTime();
  return Math.ceil(diffTime / msPerDay);
}

// Get date granularity SQL
function getDateGranularity(
  granularity: string,
  column: string,
  helpers: SqlHelpers,
  dateRange?: { startDate: Date; endDate: Date },
): string {
  if (granularity === "auto") {
    if (!dateRange) {
      // Default to daily if no date range provided
      return helpers.dateTrunc(column, "day");
    }
    const days = calculateDaysBetween(dateRange.startDate, dateRange.endDate);
    let autoGranularity: string;
    if (days < 7) {
      autoGranularity = "hour";
    } else if (days <= 90) {
      autoGranularity = "day";
    } else if (days <= 365) {
      autoGranularity = "week";
    } else {
      autoGranularity = "month";
    }
    return helpers.dateTrunc(column, autoGranularity);
  }
  // Map granularity values
  const granularityMap: Record<string, string> = {
    hour: "hour",
    day: "day",
    week: "week",
    month: "month",
    year: "year",
  };
  return helpers.dateTrunc(column, granularityMap[granularity] || "day");
}

// Generate row filter SQL
function generateRowFilterSQL(
  rowFilters: RowFilter[],
  factTable: Pick<
    FactTableInterface,
    "columns" | "filters" | "userIdTypes"
  > | null,
  helpers: SqlHelpers,
): string[] {
  if (!factTable || !rowFilters.length) {
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

// Generate fact table CTE
function generateFactTableCTE(
  config: ProductAnalyticsConfig,
  factTable: Pick<
    FactTableInterface,
    "sql" | "columns" | "filters" | "userIdTypes"
  > | null,
  factTableIndex: number,
  helpers: SqlHelpers,
  dateRange: { startDate: Date; endDate: Date },
): string {
  const cteName = `_factTable${factTableIndex}`;

  if (!factTable) {
    throw new Error("Fact table is required");
  }

  const timestampColumn = factTable.timestampColumn || "timestamp";

  const baseSql = factTable.sql;

  // Collect all metric filters (ORed together)
  const metricFilters: string[] = [];
  if (config.dataset?.values) {
    for (const value of config.dataset.values) {
      const filters = generateRowFilterSQL(
        value.rowFilters,
        factTable,
        helpers,
      );
      if (filters.length > 0) {
        metricFilters.push(`(${filters.join(" AND ")})`);
      }
    }
  }

  const whereClauses: string[] = [];

  // Date range filter
  whereClauses.push(
    `${timestampColumn} >= ${helpers.toTimestamp(dateRange.startDate)} AND ${timestampColumn} <= ${helpers.toTimestamp(dateRange.endDate)}`,
  );

  // Metric filters (ORed together)
  if (metricFilters.length > 0) {
    whereClauses.push(`(${metricFilters.join(" OR ")})`);
  }

  const whereClause =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  return `  ${cteName} AS (
    SELECT * FROM (
      -- Raw fact table SQL
      ${baseSql}
    ) t
    ${whereClause}
  )`;
}

// Generate dynamic dimension CTE
function generateDynamicDimensionCTE(
  dimension: Extract<
    ProductAnalyticsConfig["dimensions"][number],
    { dimensionType: "dynamic" }
  >,
  factTableIndex: number,
  dimensionIndex: number,
): string {
  const cteName = `_dimension${dimensionIndex}_top`;
  const factTableName = `_factTable${factTableIndex}`;

  return `  ${cteName} AS (
    SELECT ${dimension.column}
    FROM ${factTableName}
    GROUP BY ${dimension.column}
    ORDER BY COUNT(*) DESC
    LIMIT ${dimension.maxValues}
  )`;
}

// Generate dimension expression
function generateDimensionExpression(
  dimension: ProductAnalyticsConfig["dimensions"][number],
  dimensionIndex: number,
  factTableIndex: number,
  helpers: SqlHelpers,
  factTable: Pick<
    FactTableInterface,
    "columns" | "filters" | "userIdTypes"
  > | null,
  dateRange?: { startDate: Date; endDate: Date },
): string {
  switch (dimension.dimensionType) {
    case "date": {
      const column = dimension.column || "timestamp";
      const granularity = getDateGranularity(
        dimension.dateGranularity,
        column,
        helpers,
        dateRange,
      );
      return `${granularity} as dimension${dimensionIndex}`;
    }
    case "dynamic": {
      const topCTE = `_dimension${dimensionIndex}_top`;
      const columnExpr = factTable
        ? getColumnExpression(dimension.column, factTable, helpers.jsonExtract)
        : dimension.column;
      return `CASE 
        WHEN ${columnExpr} IN (SELECT ${dimension.column} FROM ${topCTE}) THEN ${columnExpr}
        ELSE 'other'
      END AS dimension${dimensionIndex}`;
    }
    case "static": {
      const columnExpr = factTable
        ? getColumnExpression(dimension.column, factTable, helpers.jsonExtract)
        : dimension.column;
      const conditions = dimension.values
        .map((v) => `${columnExpr} = '${helpers.escapeStringLiteral(v)}'`)
        .join(" OR ");
      return `CASE 
        WHEN (${conditions}) THEN ${columnExpr}
        ELSE 'other'
      END AS dimension${dimensionIndex}`;
    }
    case "slice": {
      const cases = dimension.slices
        .map(
          (slice) =>
            `WHEN (${generateRowFilterSQL(slice.filters, factTable, helpers).join(" AND ")}) THEN '${helpers.escapeStringLiteral(slice.name)}'`,
        )
        .join("\n        ");
      return `CASE
        ${cases}
        ELSE 'other'
      END AS dimension${dimensionIndex}`;
    }
  }
}
// Determine value type from a ColumnRef
function getValueTypeFromColumnRef(columnRef: {
  column: string;
  aggregation?: "sum" | "max" | "count distinct" | null;
}): "count" | "sum" | "max" | "unit_count" | "count_distinct" | "quantile" {
  const { column, aggregation } = columnRef;

  // Special column values
  if (column === "$$distinctUsers") {
    return "unit_count";
  }
  if (column === "$$count") {
    return "count";
  }

  // Otherwise, determine from aggregation
  if (aggregation === "sum") {
    return "sum";
  }
  if (aggregation === "max") {
    return "max";
  }
  if (aggregation === "count distinct") {
    return "count_distinct";
  }

  // Default to sum if no aggregation specified and column is not special
  return "sum";
}

// Helper to create minimal FactMetricInterface for simple values
function createSimpleMetric(
  factTableId: string,
  valueType: "count" | "sum" | "unit_count",
  valueColumn: string | null,
  rowFilters: RowFilter[],
  datasource: string,
  name: string,
): FactMetricInterface {
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
    factTableId,
    column,
    aggregation,
    rowFilters,
  };

  return {
    id: `simple_${name}_${Date.now()}`,
    organization: "",
    datasource,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name,
    description: "",
    owner: "",
    projects: [],
    tags: [],
    inverse: false,
    archived: false,
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
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0.3,
    },
    maxPercentChange: DEFAULT_MAX_PERCENT_CHANGE,
    minPercentChange: DEFAULT_MIN_PERCENT_CHANGE,
    minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
    targetMDE: 0.1,
    displayAsPercentage: false,
    winRisk: DEFAULT_WIN_RISK_THRESHOLD,
    loseRisk: DEFAULT_LOSE_RISK_THRESHOLD,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 0,
    quantileSettings: null,
  };
}

// Convert dataset into fact tables and metrics
function convertDatasetToFactTablesAndMetrics(
  config: ProductAnalyticsConfig,
  factTableMap: FactTableMap,
  metricMap: Map<string, FactMetricInterface>,
  datasourceSettings: DataSourceSettings | null,
): {
  factTables: Array<
    Pick<
      FactTableInterface,
      "sql" | "columns" | "filters" | "userIdTypes" | "timestampColumn"
    >
  >;
  metrics: MetricWithMetadata[];
  factTableIndexMap: Map<string, number>; // factTableId or "sql" -> index
} {
  const factTables: Array<
    Pick<
      FactTableInterface,
      "sql" | "columns" | "filters" | "userIdTypes" | "timestampColumn"
    >
  > = [];
  const metrics: MetricWithMetadata[] = [];
  const factTableIndexMap = new Map<string, number>(); // factTableId or "sql" -> index

  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  // Convert based on dataset type
  if (config.dataset.type === "sql") {
    // SQL dataset - create stub fact table
    const stubFactTable = createStubFactTable(
      config.dataset.sql,
      config.dataset.timestampColumn,
      config.dataset.columnTypes,
      datasourceSettings,
    );
    const factTableWithTimestamp = {
      ...stubFactTable,
      timestampColumn: config.dataset.timestampColumn,
    };
    const factTableIndex = 0;
    factTables.push(factTableWithTimestamp);
    factTableIndexMap.set("sql", factTableIndex);

    // Convert values to metrics - create minimal FactMetricInterface objects
    const datasource = config.dataset.datasource;
    config.dataset.values.forEach((value, idx) => {
      const simpleMetric = createSimpleMetric(
        "sql", // Use "sql" as the fact table ID for stub fact tables
        value.valueType,
        value.valueColumn,
        value.rowFilters,
        datasource,
        value.name,
      );
      metrics.push({
        metric: simpleMetric,
        prefix: `m${idx}`,
        factTableIndex,
        unit: value.unit || null,
      });
    });
  } else if (config.dataset.type === "fact_table") {
    // Fact table dataset
    const factTable = factTableMap.get(config.dataset.factTableId);
    if (!factTable) {
      throw new Error(`Fact table ${config.dataset.factTableId} not found`);
    }
    const factTableWithTimestamp = {
      sql: factTable.sql,
      columns: factTable.columns,
      filters: factTable.filters,
      userIdTypes: factTable.userIdTypes,
      timestampColumn: factTable.timestampColumn || "timestamp",
    };
    const factTableIndex = 0;
    factTables.push(factTableWithTimestamp);
    factTableIndexMap.set(config.dataset.factTableId, factTableIndex);

    // Convert values to metrics - create minimal FactMetricInterface objects
    config.dataset.values.forEach((value, idx) => {
      const simpleMetric = createSimpleMetric(
        config.dataset.factTableId,
        value.valueType,
        value.valueColumn,
        value.rowFilters,
        factTable.datasource,
        value.name,
      );
      metrics.push({
        metric: simpleMetric,
        prefix: `m${idx}`,
        factTableIndex,
        unit: value.unit || null,
      });
    });
  } else if (config.dataset.type === "metric") {
    // Metric dataset - may have multiple sources (one per fact table)
    // First, collect all unique fact tables
    const factTableIds = new Set<string>();
    config.dataset.values.forEach((value) => {
      const metric = metricMap.get(value.metricId);
      if (metric) {
        factTableIds.add(metric.numerator.factTableId);
        if (metric.denominator) {
          factTableIds.add(metric.denominator.factTableId);
        }
      }
    });

    // Create fact tables for each unique fact table
    let factTableIndex = 0;
    factTableIds.forEach((factTableId) => {
      const factTable = factTableMap.get(factTableId);
      if (!factTable) {
        throw new Error(`Fact table ${factTableId} not found`);
      }
      const factTableWithTimestamp = {
        sql: factTable.sql,
        columns: factTable.columns,
        filters: factTable.filters,
        userIdTypes: factTable.userIdTypes,
        timestampColumn: factTable.timestampColumn || "timestamp",
      };
      factTables.push(factTableWithTimestamp);
      factTableIndexMap.set(factTableId, factTableIndex);
      factTableIndex++;
    });

    // Convert metrics - split ratio metrics into numerator and denominator
    let valueIndex = 0;
    config.dataset.values.forEach((value) => {
      const metric = metricMap.get(value.metricId);
      if (!metric) {
        return; // Skip if metric not found
      }

      // Merge additional row filters from the dataset value
      const numeratorRowFilters = [
        ...(metric.numerator.rowFilters || []),
        ...value.rowFilters,
      ];
      const denominatorRowFilters = metric.denominator
        ? [...(metric.denominator.rowFilters || []), ...value.rowFilters]
        : [];

      // Create numerator metric (with denominator set to null for ratio metrics)
      const numeratorMetric: FactMetricInterface = {
        ...metric,
        numerator: {
          ...metric.numerator,
          rowFilters: numeratorRowFilters,
        },
        denominator: null, // Remove denominator for numerator calculation
      };

      const numeratorFactTableIndex =
        factTableIndexMap.get(metric.numerator.factTableId) ?? 0;
      metrics.push({
        metric: numeratorMetric,
        prefix: `m${valueIndex}`,
        factTableIndex: numeratorFactTableIndex,
        isDenominator: false,
        unit: value.unit || null,
      });

      // Add denominator if it exists
      if (metric.denominator) {
        // Create denominator metric (standalone metric for denominator calculation)
        const denominatorMetric: FactMetricInterface = {
          ...metric,
          numerator: {
            ...metric.denominator,
            rowFilters: denominatorRowFilters,
          },
          denominator: null,
        };

        const denominatorFactTableIndex =
          factTableIndexMap.get(metric.denominator.factTableId) ?? 0;
        metrics.push({
          metric: denominatorMetric,
          prefix: `m${valueIndex}_denominator`,
          factTableIndex: denominatorFactTableIndex,
          isDenominator: true,
          unit: value.denominatorUnit || null,
        });
      }

      valueIndex++;
    });
  }

  return { factTables, metrics, factTableIndexMap };
}

// Generate metric value expression from metric with metadata
function generateMetricValueExpression(
  metricWithMetadata: MetricWithMetadata,
  factTable: Pick<
    FactTableInterface,
    "columns" | "filters" | "userIdTypes"
  > | null,
  helpers: SqlHelpers,
): {
  valueExpr: string;
  isUnitCount: boolean;
  isDistinctCount: boolean;
  isQuantile: boolean;
  unitColumn: string | null;
  hasPercentileCap: boolean;
  hasAbsoluteCap: boolean;
  absoluteCapValue: number | null;
  percentileCapValue: number | null;
  ignoreZeros: boolean;
} {
  const { prefix, metric, unit } = metricWithMetadata;
  const numerator = metric.numerator;

  // Extract value type from numerator
  const valueType = getValueTypeFromColumnRef({
    column: numerator.column || "",
    aggregation: numerator.aggregation || null,
  });

  // For quantile metrics, check if it's unit-level
  const isUnitQuantile =
    metric.metricType === "quantile" &&
    metric.quantileSettings?.type === "unit";

  // Override for quantile metrics (but keep underlying type for unit quantiles)
  const finalValueType =
    metric.metricType === "quantile" && !isUnitQuantile
      ? "quantile"
      : valueType;

  const valueColumn = numerator.column || null;
  const rowFilters = numerator.rowFilters || [];
  const cappingSettings = metric.cappingSettings;
  const quantileSettings = metric.quantileSettings;

  // Extract capping info
  const hasPercentileCap = cappingSettings?.type === "percentile";
  const hasAbsoluteCap = cappingSettings?.type === "absolute";
  const absoluteCapValue = hasAbsoluteCap ? cappingSettings.value : null;
  const percentileCapValue = hasPercentileCap ? cappingSettings.value : null;
  const ignoreZeros = cappingSettings?.ignoreZeros || false;

  // Build row filters
  const filterSQL = generateRowFilterSQL(rowFilters, factTable, helpers);
  const filterCondition =
    filterSQL.length > 0 ? `(${filterSQL.join(" AND ")})` : "TRUE";

  // Build value column expression
  // For unit_count with aggregate filters, use aggregateFilterColumn instead of valueColumn
  let valueColumnExpr = "1";
  if (
    valueType === "unit_count" &&
    metricValue.aggregateFilterSettings?.aggregateFilterColumn
  ) {
    // Use aggregateFilterColumn for unit_count metrics with aggregate filters
    const aggFilterCol =
      metricValue.aggregateFilterSettings.aggregateFilterColumn;
    valueColumnExpr = factTable
      ? getColumnExpression(aggFilterCol, factTable, helpers.jsonExtract)
      : aggFilterCol;
  } else if (valueColumn) {
    valueColumnExpr = factTable
      ? getColumnExpression(valueColumn, factTable, helpers.jsonExtract)
      : valueColumn;
  }

  // Apply absolute capping inline if present
  let cappedValueColumn = valueColumnExpr;
  if (hasAbsoluteCap && absoluteCapValue !== null) {
    cappedValueColumn = helpers.least(
      valueColumnExpr,
      String(absoluteCapValue),
    );
  }

  // For percentile capping, reference the cap from the percentile caps CTE
  const percentileCapRef = hasPercentileCap ? `caps.${prefix}_cap` : null;
  const finalValueColumn =
    hasPercentileCap && percentileCapRef
      ? helpers.least(
          cappedValueColumn,
          helpers.coalesce(percentileCapRef, cappedValueColumn),
        )
      : cappedValueColumn;

  // Generate value expression based on type
  let valueExpr: string;
  const isUnitCount = finalValueType === "unit_count";
  // max and count_distinct are also unit-level aggregations
  // Unit quantiles are also unit-level (aggregate per unit, then take quantile)
  const isUnitLevel =
    isUnitCount ||
    finalValueType === "max" ||
    finalValueType === "count_distinct" ||
    isUnitQuantile;

  // Determine unit column for unit-level aggregations
  let unitColumn: string | null = null;
  if (isUnitLevel) {
    if (unit) {
      // Use provided unit from config
      unitColumn = unit;
    } else if (factTable?.userIdTypes && factTable.userIdTypes.length > 0) {
      // Use first userIdType from fact table
      unitColumn = factTable.userIdTypes[0];
    } else {
      // Fallback to user_id
      unitColumn = "user_id";
    }
  }

  switch (finalValueType) {
    case "count":
      valueExpr = `CASE WHEN ${filterCondition} THEN 1 ELSE NULL END as ${prefix}_value`;
      break;
    case "count_distinct":
      valueExpr = `CASE WHEN ${filterCondition} THEN ${valueColumnExpr} ELSE NULL END as ${prefix}_value`;
      break;
    case "sum":
      valueExpr = `CASE WHEN ${filterCondition} THEN ${finalValueColumn} ELSE NULL END as ${prefix}_value`;
      break;
    case "max":
      valueExpr = `CASE WHEN ${filterCondition} THEN ${finalValueColumn} ELSE NULL END as ${prefix}_value`;
      break;
    case "unit_count":
      valueExpr = `CASE WHEN ${filterCondition} THEN 1 ELSE NULL END as ${prefix}_value`;
      break;
    case "quantile":
      valueExpr = `CASE WHEN ${filterCondition} THEN ${finalValueColumn} ELSE NULL END as ${prefix}_value`;
      break;
    default:
      valueExpr = `CASE WHEN ${filterCondition} THEN 1 ELSE NULL END as ${prefix}_value`;
  }

  return {
    valueExpr,
    isUnitCount: isUnitLevel, // Treat max and count_distinct as unit-level
    isDistinctCount: finalValueType === "count_distinct",
    isQuantile: metric.metricType === "quantile" || !!quantileSettings,
    unitColumn,
    hasPercentileCap,
    hasAbsoluteCap,
    absoluteCapValue,
    percentileCapValue,
    ignoreZeros,
  };
}

// Main SQL generator function
// Create a stub fact table from SQL dataset column types
function createStubFactTable(
  sql: string,
  timestampColumn: string,
  columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  >,
  datasourceSettings: DataSourceSettings | null,
): Pick<
  FactTableInterface,
  "sql" | "columns" | "filters" | "userIdTypes",
  "timestampColumn"
> {
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
  let userIdTypes: string[] = ["user_id"]; // Default fallback
  if (datasourceSettings?.userIdTypes) {
    // Extract userIdType strings and filter to only those that exist in columns
    userIdTypes = datasourceSettings.userIdTypes
      .map((ut) => ut.userIdType)
      .filter((userIdType) => columnNames.has(userIdType));

    // If intersection is empty, fall back to default
    if (userIdTypes.length === 0) {
      userIdTypes = ["user_id"];
    }
  }

  return {
    sql,
    columns,
    filters: [],
    userIdTypes,
    timestampColumn,
  };
}

// Minimal datasource interface for SQL datasets
export interface MinimalDatasourceInterface {
  settings?: DataSourceSettings | null;
}

export function generateProductAnalyticsSQL(
  config: ProductAnalyticsConfig,
  options: {
    factTableMap?: FactTableMap;
    metricMap?: Map<string, FactMetricInterface>;
    sqlHelpers?: Partial<SqlHelpers>;
    datasource?: MinimalDatasourceInterface; // For SQL datasets, provide datasource with settings
  },
): string {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  const helpers = { ...defaultSqlHelpers, ...options.sqlHelpers };
  const factTableMap =
    options.factTableMap || new Map<string, FactTableInterface>();
  const metricMap = options.metricMap || new Map<string, FactMetricInterface>();
  const dateRange = calculateDateRange(config.dateRange);

  // Convert dataset into fact tables and metrics
  const { factTables, metrics } = convertDatasetToFactTablesAndMetrics(
    config,
    factTableMap,
    metricMap,
    options.datasource?.settings || null,
  );

  // Use the first fact table for dimensions (if any)
  const primaryFactTable = factTables[0] || null;
  const primaryFactTableIndex = 0;

  const ctes: string[] = [];

  // Generate fact table CTEs for each fact table
  factTables.forEach((factTable, index) => {
    ctes.push(
      generateFactTableCTE(config, factTable, index, helpers, dateRange),
    );
  });

  // Generate dynamic dimension CTEs
  // Use the primary fact table for dynamic dimensions
  config.dimensions.forEach((dimension, idx) => {
    if (dimension.dimensionType === "dynamic") {
      ctes.push(
        generateDynamicDimensionCTE(dimension, primaryFactTableIndex, idx),
      );
    }
  });

  // Collect metric capping information from metrics
  const metricCappingInfo = new Map<
    number,
    {
      hasPercentileCap: boolean;
      hasAbsoluteCap: boolean;
      percentileCapValue: number | null;
      factTableIndex: number;
      prefix: string;
      ignoreZeros: boolean;
    }
  >();

  metrics.forEach((metricValue, idx) => {
    const factTable = factTables[metricValue.factTableIndex] || null;

    const metric = generateMetricValueExpression(
      metricValue,
      factTable,
      helpers,
    );

    if (metric.hasPercentileCap || metric.hasAbsoluteCap) {
      metricCappingInfo.set(idx, {
        hasPercentileCap: metric.hasPercentileCap,
        hasAbsoluteCap: metric.hasAbsoluteCap,
        percentileCapValue: metric.percentileCapValue,
        factTableIndex: metricValue.factTableIndex,
        prefix: metricValue.prefix,
        ignoreZeros: metric.ignoreZeros,
      });
    }
  });

  // Generate percentile caps CTEs for each fact table that has percentile-capped metrics
  const percentileCapsByFactTable = new Map<
    number,
    Array<{
      metricIndex: number;
      prefix: string;
      percentile: number;
      ignoreZeros: boolean;
      metricValue: MetricWithMetadata;
    }>
  >();

  metricCappingInfo.forEach((info, metricIndex) => {
    if (info.hasPercentileCap && info.percentileCapValue !== null) {
      const factTableIdx = info.factTableIndex;
      if (!percentileCapsByFactTable.has(factTableIdx)) {
        percentileCapsByFactTable.set(factTableIdx, []);
      }
      percentileCapsByFactTable.get(factTableIdx)?.push({
        metricIndex,
        prefix: info.prefix,
        percentile: info.percentileCapValue,
        ignoreZeros: info.ignoreZeros,
        metricValue: metrics[metricIndex],
      });
    }
  });

  // Generate percentile caps CTEs
  percentileCapsByFactTable.forEach((caps, factTableIdx) => {
    const factTable = factTables[factTableIdx] || null;

    const capSelects: string[] = [];
    caps.forEach((cap) => {
      const { metricValue, percentile, ignoreZeros, prefix } = cap;

      // Build the value expression for the percentile calculation
      let percentileValueExpr = "1";
      if (metricValue.valueColumn) {
        percentileValueExpr = factTable
          ? getColumnExpression(
              metricValue.valueColumn,
              factTable,
              helpers.jsonExtract,
            )
          : metricValue.valueColumn;
      }

      // Build filter condition
      const filterSQL = generateRowFilterSQL(
        metricValue.rowFilters,
        factTable,
        helpers,
      );
      const filterCondition =
        filterSQL.length > 0 ? `(${filterSQL.join(" AND ")})` : "TRUE";

      // Build the CASE expression
      // If ignoreZeros is true, exclude zeros from the percentile calculation
      const caseExpr = ignoreZeros
        ? `CASE WHEN ${filterCondition} AND ${percentileValueExpr} != 0 THEN ${percentileValueExpr} ELSE NULL END`
        : `CASE WHEN ${filterCondition} THEN ${percentileValueExpr} ELSE NULL END`;

      capSelects.push(
        `-- ${percentile * 100}th percentile of ${prefix}\n      ${helpers.percentileApprox(caseExpr, percentile)} as ${prefix}_cap`,
      );
    });

    const percentileCapsCTE = `  _factTable${factTableIdx}_percentile_caps AS (
    SELECT
      ${capSelects.join(",\n      ")}
    FROM _factTable${sourceIdx}
  )`;

    ctes.push(percentileCapsCTE);
  });

  const hasPercentileCaps = percentileCapsByFactTable.size > 0;

  // Generate rows CTE
  // For now, we'll use the primary source for dimensions
  // In a more complex implementation, we might need separate row CTEs per source
  const dimensionExpressions = config.dimensions.map((dim, idx) =>
    generateDimensionExpression(
      dim,
      idx,
      primaryFactTableIndex,
      helpers,
      primaryFactTable,
      dateRange,
    ),
  );

  const metricExpressions: string[] = [];
  const unitColumns = new Set<string>();
  metrics.forEach((metricValue) => {
    const factTable = factTables[metricValue.factTableIndex] || null;
    const metric = generateMetricValueExpression(
      metricValue,
      factTable,
      helpers,
    );
    metricExpressions.push(metric.valueExpr);
    if (metric.unitColumn) {
      unitColumns.add(metric.unitColumn);
    }
  });

  const unitSelects = Array.from(unitColumns).map(
    (unit, idx) => `${unit} as unit${idx}`,
  );

  // Use primary fact table for rows CTE
  // TODO: In a more complex implementation, we might need to join multiple fact tables
  const percentileCapsJoin =
    hasPercentileCaps && percentileCapsByFactTable.has(primaryFactTableIndex)
      ? `CROSS JOIN _factTable${primaryFactTableIndex}_percentile_caps caps`
      : "";

  const rowsCTE = `  _factTable${primaryFactTableIndex}_rows AS (
    SELECT
      ${dimensionExpressions.join(",\n      ")},
      ${unitSelects.length > 0 ? unitSelects.join(",\n      ") + "," : ""}
      ${metricExpressions.join(",\n      ")}
    FROM _factTable${primaryFactTableIndex}
    ${percentileCapsJoin}
  )`;

  ctes.push(rowsCTE);

  // Generate unit aggregation CTEs
  if (unitColumns.size > 0) {
    const unitAggregations: string[] = [];
    metrics.forEach((metricValue) => {
      const factTable =
        factTables[metricValue.factTableIndex]?.factTable || null;
      const metric = generateMetricValueExpression(
        metricValue,
        factTable,
        helpers,
      );
      if (metric.isUnitCount && metric.unitColumn) {
        // Handle unit-level aggregations: unit_count, max, count_distinct, unit quantiles
        if (metricValue.quantileSettings?.type === "unit") {
          // For unit quantiles, aggregate per unit using the underlying aggregation
          const aggType = metricValue.unitQuantileAggregation || "sum";
          if (aggType === "max") {
            unitAggregations.push(
              `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
            );
          } else if (aggType === "count_distinct") {
            unitAggregations.push(
              `COUNT(DISTINCT ${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
            );
          } else {
            // sum (default)
            unitAggregations.push(
              `SUM(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
            );
          }
        } else if (metricValue.valueType === "max") {
          // For max, calculate MAX per unit
          unitAggregations.push(
            `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
          );
        } else if (metricValue.valueType === "count_distinct") {
          // For count distinct, calculate COUNT(DISTINCT) per unit
          unitAggregations.push(
            `COUNT(DISTINCT ${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
          );
        } else if (metricValue.valueType === "unit_count") {
          // Check if this has aggregate filter settings
          if (metricValue.aggregateFilterSettings) {
            // Use getAggregateFilters to convert aggregateFilter to SQL conditions
            // We need to create a mock ColumnRef for getAggregateFilters
            const mockColumnRef = {
              aggregateFilter:
                metricValue.aggregateFilterSettings.aggregateFilter,
              aggregateFilterColumn:
                metricValue.aggregateFilterSettings.aggregateFilterColumn,
              column: metricValue.valueColumn || "$$distinctUsers",
            };
            const aggregateFilters = getAggregateFilters({
              columnRef: mockColumnRef,
              column: metricValue.aggregateFilterSettings.aggregateFilterColumn,
              ignoreInvalid: true,
            });

            if (aggregateFilters.length > 0) {
              // Apply aggregate filter: SUM the column and check the condition
              // Replace the column name in the filter with SUM(prefix_value)
              const sumExpr = `SUM(${metricValue.prefix}_value)`;
              const colName =
                metricValue.aggregateFilterSettings.aggregateFilterColumn;
              const filterConditions = aggregateFilters
                .map((filter) => {
                  // Replace the column name with the SUM expression
                  return filter.replace(
                    new RegExp(`\\b${colName}\\b`),
                    sumExpr,
                  );
                })
                .join(" AND ");

              unitAggregations.push(
                `CASE WHEN ${filterConditions} THEN 1 ELSE NULL END as ${metricValue.prefix}_value`,
              );
            } else {
              // Fallback if filters couldn't be parsed
              unitAggregations.push(
                `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
              );
            }
          } else {
            // Standard unit count without aggregate filter
            unitAggregations.push(
              `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
            );
          }
        }
      }
    });

    if (unitAggregations.length > 0) {
      const unitGroupBy = [
        ...Array.from(unitColumns).map((_, idx) => `unit${idx}`),
        ...config.dimensions.map((_, idx) => `dimension${idx}`),
      ].join(", ");

      const unitCTE = `  _factTable${primaryFactTableIndex}_unit0 AS (
    SELECT
      ${unitGroupBy.split(", ").join(",\n      ")},
      ${unitAggregations.join(",\n      ")}
    FROM _factTable${primaryFactTableIndex}_rows
    GROUP BY ${unitGroupBy}
  )`;

      ctes.push(unitCTE);

      // Generate unit rollup CTE
      const unitRollupSelects: string[] = [];
      config.dimensions.forEach((_, idx) => {
        unitRollupSelects.push(`dimension${idx}`);
      });
      metrics.forEach((metricValue) => {
        const factTable =
          factTables[metricValue.factTableIndex]?.factTable || null;
        const metric = generateMetricValueExpression(
          metricValue,
          factTable,
          helpers,
        );
        // Unit-level aggregations
        if (metric.isUnitCount && metric.unitColumn) {
          if (metricValue.quantileSettings?.type === "unit") {
            // For unit quantiles, calculate the quantile of unit values
            const quantile = metricValue.quantileSettings.quantile;
            unitRollupSelects.push(
              `${helpers.percentileApprox(`${metricValue.prefix}_value`, quantile)} as ${metricValue.prefix}_value`,
            );
          } else {
            // Other unit-level aggregations (unit_count, max, count_distinct) are summed in rollup
            unitRollupSelects.push(
              `SUM(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
            );
          }
        } else {
          unitRollupSelects.push(`NULL as ${metricValue.prefix}_value`);
        }
        // Check if this is a denominator (ratio metrics have separate entries)
        if (metricValue.isDenominator) {
          // Denominator is handled separately, skip
        }
      });

      const unitRollupCTE = `  _factTable${primaryFactTableIndex}_unit0_rollup AS (
    SELECT
      ${unitRollupSelects.join(",\n      ")}
    FROM _factTable${primaryFactTableIndex}_unit0
    GROUP BY ${config.dimensions.map((_, idx) => `dimension${idx}`).join(", ")}
  )`;

      ctes.push(unitRollupCTE);
    }
  }

  // Generate event rollup CTE
  const eventRollupSelects: string[] = [];
  config.dimensions.forEach((_, idx) => {
    eventRollupSelects.push(`dimension${idx}`);
  });
  metrics.forEach((metricValue) => {
    const factTable = factTables[metricValue.factTableIndex] || null;
    const metric = generateMetricValueExpression(
      metricValue,
      factTable,
      helpers,
    );
    if (metric.isUnitCount) {
      eventRollupSelects.push(`NULL as ${metricValue.prefix}_value`);
    } else if (metric.isDistinctCount) {
      eventRollupSelects.push(
        `COUNT(DISTINCT ${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    } else if (metric.isQuantile) {
      const quantile = metricValue.quantileSettings?.quantile || 0.9;
      eventRollupSelects.push(
        `${helpers.percentileApprox(`${metricValue.prefix}_value`, quantile)} as ${metricValue.prefix}_value`,
      );
    } else if (metricValue.valueType === "max") {
      eventRollupSelects.push(
        `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    } else {
      eventRollupSelects.push(
        `SUM(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    }
  });

  const eventRollupCTE = `  _factTable${primaryFactTableIndex}_event_rollup AS (
    SELECT
      ${eventRollupSelects.join(",\n      ")}
    FROM _factTable${primaryFactTableIndex}_rows
    GROUP BY ${config.dimensions.map((_, idx) => `dimension${idx}`).join(", ")}
  )`;

  ctes.push(eventRollupCTE);

  // Generate combined rollup CTE
  const rollupCTEs: string[] = [];
  if (unitColumns.size > 0) {
    rollupCTEs.push(`_factTable${primaryFactTableIndex}_unit0_rollup`);
  }
  rollupCTEs.push(`_factTable${primaryFactTableIndex}_event_rollup`);

  const combinedRollupCTE = `  _combined_rollup AS (
    SELECT * FROM ${rollupCTEs[0]}
    ${rollupCTEs.length > 1 ? `UNION ALL\n    SELECT * FROM ${rollupCTEs[1]}` : ""}
  )`;

  ctes.push(combinedRollupCTE);

  // Generate final SELECT
  const finalSelects: string[] = [];
  config.dimensions.forEach((_, idx) => {
    finalSelects.push(`dimension${idx}`);
  });
  metrics.forEach((metricValue) => {
    const factTable = factTables[metricValue.factTableIndex] || null;
    const metric = generateMetricValueExpression(
      metricValue,
      factTable,
      helpers,
    );
    if (metric.isQuantile) {
      finalSelects.push(
        `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    } else if (metricValue.valueType === "max") {
      finalSelects.push(
        `MAX(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    } else {
      finalSelects.push(
        `SUM(${metricValue.prefix}_value) as ${metricValue.prefix}_value`,
      );
    }
  });

  const finalGroupBy = config.dimensions
    .map((_, idx) => `dimension${idx}`)
    .join(", ");

  const finalSelect = `SELECT
  ${finalSelects.join(",\n  ")}
FROM _combined_rollup
${finalGroupBy ? `GROUP BY ${finalGroupBy}` : ""}
-- Sanity check limit
LIMIT 1000;`;

  return `WITH 
${ctes.join(",\n\n")}

-- Aggregate to return a single row${finalGroupBy ? " per dimension" : ""}
${finalSelect}`;
}
