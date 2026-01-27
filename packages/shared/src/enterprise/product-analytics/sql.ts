import { z } from "zod";
import {
  RowFilter,
  FactTableInterface,
  FactTableMap,
  FactMetricInterface,
} from "shared/types/fact-table";
import {
  productAnalyticsConfigValidator,
  sqlDatasetColumnResponseValidator,
} from "../../validators/product-analytics";
import {
  getRowFilterSQL,
  getColumnExpression,
  getAggregateFilters,
} from "../../experiments";

// Type definitions
export type ProductAnalyticsConfig = z.infer<
  typeof productAnalyticsConfigValidator
>;
export type SqlDatasetColumnResponse = z.infer<
  typeof sqlDatasetColumnResponseValidator
>;

// Normalized interfaces
export interface Source {
  sql: string;
  timestampColumn: string;
  index: number;
  factTable: Pick<
    FactTableInterface,
    "sql" | "columns" | "filters" | "userIdTypes"
  > | null;
}

export interface NormalizedValue {
  sourceIndex: number;
  prefix: string; // e.g. 'm0' or 'm0_denominator'
  valueType:
    | "count"
    | "sum"
    | "max"
    | "unit_count"
    | "count_distinct"
    | "quantile";
  valueColumn: string | null;
  unit: string | null;
  rowFilters: RowFilter[];
  // Only available for metrics
  quantileSettings?: {
    quantile: number;
    type: "unit" | "event";
    ignoreZeros: boolean;
  } | null;
  // For unit quantiles, store the underlying aggregation type (sum/max/count_distinct)
  unitQuantileAggregation?: "sum" | "max" | "count_distinct" | null;
  cappingSettings?: {
    type: "absolute" | "percentile" | "";
    value: number;
    ignoreZeros?: boolean;
  } | null;
  aggregateFilterSettings?: {
    aggregateFilter: string;
    aggregateFilterColumn: string;
  } | null;
  // Original metric index (for tracking which metric this came from)
  originalMetricIndex?: number;
  isDenominator?: boolean;
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
};

// Helper to format date for SQL
function formatDateForSql(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `'${year}-${month}-${day}'`;
}

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
  sqlDataset: { sql: string; timestampColumn: string } | null,
  factTableIndex: number,
  helpers: SqlHelpers,
  dateRange: { startDate: Date; endDate: Date },
): string {
  const cteName = `_factTable${factTableIndex}`;
  let baseSql = "";
  let timestampColumn = "timestamp";

  if (config.dataset?.type === "sql" && sqlDataset) {
    baseSql = sqlDataset.sql;
    timestampColumn = sqlDataset.timestampColumn;
  } else if (factTable) {
    // Use fact table SQL for both fact_table and metric dataset types
    baseSql = factTable.sql;
    // Assume timestamp column exists - may need to be configurable
    timestampColumn = "timestamp";
  } else {
    // Fallback if no fact table is provided
    baseSql = "SELECT * FROM events";
  }

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
    `${timestampColumn} >= ${formatDateForSql(dateRange.startDate)} AND ${timestampColumn} <= ${formatDateForSql(dateRange.endDate)}`,
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
}): NormalizedValue["valueType"] {
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

// Normalize dataset into Sources and Values
function normalizeDataset(
  config: ProductAnalyticsConfig,
  factTableMap: FactTableMap,
  metricMap: Map<string, FactMetricInterface>,
): {
  sources: Source[];
  values: NormalizedValue[];
} {
  const sources: Source[] = [];
  const values: NormalizedValue[] = [];
  const sourceIndexMap = new Map<string, number>(); // factTableId or "sql" -> index

  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  // Normalize based on dataset type
  if (config.dataset.type === "sql") {
    // SQL dataset - single source
    const sourceIndex = 0;
    sources.push({
      sql: config.dataset.sql,
      timestampColumn: config.dataset.timestampColumn,
      index: sourceIndex,
      factTable: null,
    });
    sourceIndexMap.set("sql", sourceIndex);

    // Normalize values
    config.dataset.values.forEach((value, idx) => {
      values.push({
        sourceIndex,
        prefix: `m${idx}`,
        valueType: value.valueType,
        valueColumn: value.valueColumn,
        unit: value.unit,
        rowFilters: value.rowFilters,
        originalMetricIndex: idx,
      });
    });
  } else if (config.dataset.type === "fact_table") {
    // Fact table dataset - single source
    const factTable = factTableMap.get(config.dataset.factTableId);
    if (!factTable) {
      throw new Error(`Fact table ${config.dataset.factTableId} not found`);
    }
    const sourceIndex = 0;
    sources.push({
      sql: factTable.sql,
      timestampColumn: "timestamp", // Default assumption
      index: sourceIndex,
      factTable,
    });
    sourceIndexMap.set(config.dataset.factTableId, sourceIndex);

    // Normalize values
    config.dataset.values.forEach((value, idx) => {
      values.push({
        sourceIndex,
        prefix: `m${idx}`,
        valueType: value.valueType,
        valueColumn: value.valueColumn,
        unit: value.unit,
        rowFilters: value.rowFilters,
        originalMetricIndex: idx,
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

    // Create sources for each fact table
    let sourceIndex = 0;
    factTableIds.forEach((factTableId) => {
      const factTable = factTableMap.get(factTableId);
      if (!factTable) {
        throw new Error(`Fact table ${factTableId} not found`);
      }
      sources.push({
        sql: factTable.sql,
        timestampColumn: "timestamp", // Default assumption
        index: sourceIndex,
        factTable,
      });
      sourceIndexMap.set(factTableId, sourceIndex);
      sourceIndex++;
    });

    // Normalize values - split ratio metrics into numerator and denominator
    let valueIndex = 0;
    config.dataset.values.forEach((value, originalIdx) => {
      const metric = metricMap.get(value.metricId);
      if (!metric) {
        return; // Skip if metric not found
      }

      // Determine value type from numerator ColumnRef
      const numeratorValueType = getValueTypeFromColumnRef({
        column: metric.numerator.column || "",
        aggregation: metric.numerator.aggregation || null,
      });

      // For quantile metrics, check if it's unit-level
      const isUnitQuantile =
        metric.metricType === "quantile" &&
        metric.quantileSettings?.type === "unit";

      // Override for quantile metrics (but keep underlying type for unit quantiles)
      const finalNumeratorValueType =
        metric.metricType === "quantile" && !isUnitQuantile
          ? "quantile"
          : numeratorValueType;

      // Store underlying aggregation for unit quantiles
      const unitQuantileAggregation = isUnitQuantile
        ? (metric.numerator.aggregation as
            | "sum"
            | "max"
            | "count_distinct"
            | undefined) || "sum"
        : null;

      // Add numerator
      const numeratorSourceIndex =
        sourceIndexMap.get(metric.numerator.factTableId) ?? 0;
      values.push({
        sourceIndex: numeratorSourceIndex,
        prefix: `m${valueIndex}`,
        valueType: finalNumeratorValueType,
        valueColumn: metric.numerator.column || null,
        unit: value.unit || null,
        rowFilters: [
          ...(metric.numerator.rowFilters || []),
          ...value.rowFilters,
        ],
        quantileSettings: metric.quantileSettings || null,
        unitQuantileAggregation,
        cappingSettings: metric.cappingSettings || null,
        aggregateFilterSettings:
          metric.numerator.aggregateFilter &&
          metric.numerator.aggregateFilterColumn
            ? {
                aggregateFilter: metric.numerator.aggregateFilter,
                aggregateFilterColumn: metric.numerator.aggregateFilterColumn,
              }
            : null,
        originalMetricIndex: originalIdx,
        isDenominator: false,
      });

      // Add denominator if it exists
      if (metric.denominator) {
        // Determine value type from denominator ColumnRef
        const denominatorValueType = getValueTypeFromColumnRef({
          column: metric.denominator.column || "",
          aggregation: metric.denominator.aggregation || null,
        });

        const denominatorSourceIndex =
          sourceIndexMap.get(metric.denominator.factTableId) ?? 0;
        values.push({
          sourceIndex: denominatorSourceIndex,
          prefix: `m${valueIndex}_denominator`,
          valueType: denominatorValueType,
          valueColumn: metric.denominator.column || null,
          unit: value.denominatorUnit || null,
          rowFilters: [
            ...(metric.denominator.rowFilters || []),
            ...value.rowFilters,
          ],
          aggregateFilterSettings:
            metric.denominator.aggregateFilter &&
            metric.denominator.aggregateFilterColumn
              ? {
                  aggregateFilter: metric.denominator.aggregateFilter,
                  aggregateFilterColumn:
                    metric.denominator.aggregateFilterColumn,
                }
              : null,
          originalMetricIndex: originalIdx,
          isDenominator: true,
        });
      }

      valueIndex++;
    });
  }

  return { sources, values };
}

// Generate metric value expression from normalized value
function generateMetricValueExpressionFromNormalized(
  normalizedValue: NormalizedValue,
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
  const {
    prefix,
    valueType,
    valueColumn,
    unit,
    rowFilters,
    cappingSettings,
    quantileSettings,
  } = normalizedValue;

  // Extract capping info
  const hasPercentileCap = cappingSettings?.type === "percentile";
  const hasAbsoluteCap = cappingSettings?.type === "absolute";
  const absoluteCapValue = hasAbsoluteCap ? cappingSettings.value : null;
  const percentileCapValue = hasPercentileCap ? cappingSettings.value : null;
  const ignoreZeros = cappingSettings?.ignoreZeros || false;
  const isQuantile = valueType === "quantile" || !!quantileSettings;
  const isDistinctCount = valueType === "count_distinct";

  // Build row filters
  const filterSQL = generateRowFilterSQL(rowFilters, factTable, helpers);
  const filterCondition =
    filterSQL.length > 0 ? `(${filterSQL.join(" AND ")})` : "TRUE";

  // Build value column expression
  // For unit_count with aggregate filters, use aggregateFilterColumn instead of valueColumn
  let valueColumnExpr = "1";
  if (
    valueType === "unit_count" &&
    normalizedValue.aggregateFilterSettings?.aggregateFilterColumn
  ) {
    // Use aggregateFilterColumn for unit_count metrics with aggregate filters
    const aggFilterCol =
      normalizedValue.aggregateFilterSettings.aggregateFilterColumn;
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
  const isUnitCount = valueType === "unit_count";
  // max and count_distinct are also unit-level aggregations
  // Unit quantiles are also unit-level (aggregate per unit, then take quantile)
  const isUnitQuantile = quantileSettings?.type === "unit";
  const isUnitLevel =
    isUnitCount ||
    valueType === "max" ||
    valueType === "count_distinct" ||
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

  switch (valueType) {
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
    isDistinctCount,
    isQuantile,
    unitColumn,
    hasPercentileCap,
    hasAbsoluteCap,
    absoluteCapValue,
    percentileCapValue,
    ignoreZeros,
  };
}

// Main SQL generator function
export function generateProductAnalyticsSQL(
  config: ProductAnalyticsConfig,
  options: {
    factTableMap: FactTableMap;
    metricMap?: Map<string, FactMetricInterface>;
    sqlHelpers?: Partial<SqlHelpers>;
  },
): string {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  const helpers = { ...defaultSqlHelpers, ...options.sqlHelpers };
  const factTableMap = options.factTableMap;
  const metricMap = options.metricMap || new Map<string, FactMetricInterface>();
  const dateRange = calculateDateRange(config.dateRange);

  // Normalize dataset into Sources and Values
  const { sources, values } = normalizeDataset(config, factTableMap, metricMap);

  // Use the first source for dimensions (if any)
  const primarySource = sources[0];
  const primaryFactTable = primarySource?.factTable || null;
  const primarySourceIndex = primarySource?.index || 0;

  const ctes: string[] = [];

  // Generate fact table CTEs for each source
  sources.forEach((source) => {
    const sqlDataset =
      source.factTable === null
        ? {
            sql: source.sql,
            timestampColumn: source.timestampColumn,
          }
        : null;
    ctes.push(
      generateFactTableCTE(
        config,
        source.factTable,
        sqlDataset,
        source.index,
        helpers,
        dateRange,
      ),
    );
  });

  // Generate dynamic dimension CTEs
  // Use the primary source for dynamic dimensions
  config.dimensions.forEach((dimension, idx) => {
    if (dimension.dimensionType === "dynamic") {
      ctes.push(
        generateDynamicDimensionCTE(dimension, primarySourceIndex, idx),
      );
    }
  });

  // Collect metric capping information from normalized values
  const metricCappingInfo = new Map<
    number,
    {
      hasPercentileCap: boolean;
      hasAbsoluteCap: boolean;
      percentileCapValue: number | null;
      sourceIndex: number;
      prefix: string;
      ignoreZeros: boolean;
    }
  >();

  values.forEach((normalizedValue, idx) => {
    const source = sources[normalizedValue.sourceIndex];
    const factTable = source?.factTable || null;

    const metric = generateMetricValueExpressionFromNormalized(
      normalizedValue,
      factTable,
      helpers,
    );

    if (metric.hasPercentileCap || metric.hasAbsoluteCap) {
      metricCappingInfo.set(idx, {
        hasPercentileCap: metric.hasPercentileCap,
        hasAbsoluteCap: metric.hasAbsoluteCap,
        percentileCapValue: metric.percentileCapValue,
        sourceIndex: normalizedValue.sourceIndex,
        prefix: normalizedValue.prefix,
        ignoreZeros: metric.ignoreZeros,
      });
    }
  });

  // Generate percentile caps CTEs for each source that has percentile-capped metrics
  const percentileCapsBySource = new Map<
    number,
    Array<{
      valueIndex: number;
      prefix: string;
      percentile: number;
      ignoreZeros: boolean;
      normalizedValue: NormalizedValue;
    }>
  >();

  metricCappingInfo.forEach((info, valueIndex) => {
    if (info.hasPercentileCap && info.percentileCapValue !== null) {
      const sourceIdx = info.sourceIndex;
      if (!percentileCapsBySource.has(sourceIdx)) {
        percentileCapsBySource.set(sourceIdx, []);
      }
      percentileCapsBySource.get(sourceIdx)?.push({
        valueIndex,
        prefix: info.prefix,
        percentile: info.percentileCapValue,
        ignoreZeros: info.ignoreZeros,
        normalizedValue: values[valueIndex],
      });
    }
  });

  // Generate percentile caps CTEs
  percentileCapsBySource.forEach((caps, sourceIdx) => {
    const source = sources[sourceIdx];
    const factTable = source?.factTable || null;

    const capSelects: string[] = [];
    caps.forEach((cap) => {
      const { normalizedValue, percentile, ignoreZeros, prefix } = cap;

      // Build the value expression for the percentile calculation
      let percentileValueExpr = "1";
      if (normalizedValue.valueColumn) {
        percentileValueExpr = factTable
          ? getColumnExpression(
              normalizedValue.valueColumn,
              factTable,
              helpers.jsonExtract,
            )
          : normalizedValue.valueColumn;
      }

      // Build filter condition
      const filterSQL = generateRowFilterSQL(
        normalizedValue.rowFilters,
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

    const percentileCapsCTE = `  _factTable${sourceIdx}_percentile_caps AS (
    SELECT
      ${capSelects.join(",\n      ")}
    FROM _factTable${sourceIdx}
  )`;

    ctes.push(percentileCapsCTE);
  });

  const hasPercentileCaps = percentileCapsBySource.size > 0;

  // Generate rows CTE
  // For now, we'll use the primary source for dimensions
  // In a more complex implementation, we might need separate row CTEs per source
  const dimensionExpressions = config.dimensions.map((dim, idx) =>
    generateDimensionExpression(
      dim,
      idx,
      primarySourceIndex,
      helpers,
      primaryFactTable,
      dateRange,
    ),
  );

  const metricExpressions: string[] = [];
  const unitColumns = new Set<string>();
  values.forEach((normalizedValue) => {
    const source = sources[normalizedValue.sourceIndex];
    const factTable = source?.factTable || null;

    const metric = generateMetricValueExpressionFromNormalized(
      normalizedValue,
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

  // Use primary source for rows CTE
  // TODO: In a more complex implementation, we might need to join multiple sources
  const percentileCapsJoin =
    hasPercentileCaps && percentileCapsBySource.has(primarySourceIndex)
      ? `CROSS JOIN _factTable${primarySourceIndex}_percentile_caps caps`
      : "";

  const rowsCTE = `  _factTable${primarySourceIndex}_rows AS (
    SELECT
      ${dimensionExpressions.join(",\n      ")},
      ${unitSelects.length > 0 ? unitSelects.join(",\n      ") + "," : ""}
      ${metricExpressions.join(",\n      ")}
    FROM _factTable${primarySourceIndex}
    ${percentileCapsJoin}
  )`;

  ctes.push(rowsCTE);

  // Generate unit aggregation CTEs
  if (unitColumns.size > 0) {
    const unitAggregations: string[] = [];
    values.forEach((normalizedValue) => {
      const source = sources[normalizedValue.sourceIndex];
      const factTable = source?.factTable || null;
      const metric = generateMetricValueExpressionFromNormalized(
        normalizedValue,
        factTable,
        helpers,
      );
      if (metric.isUnitCount && metric.unitColumn) {
        // Handle unit-level aggregations: unit_count, max, count_distinct, unit quantiles
        if (normalizedValue.quantileSettings?.type === "unit") {
          // For unit quantiles, aggregate per unit using the underlying aggregation
          const aggType = normalizedValue.unitQuantileAggregation || "sum";
          if (aggType === "max") {
            unitAggregations.push(
              `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
            );
          } else if (aggType === "count_distinct") {
            unitAggregations.push(
              `COUNT(DISTINCT ${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
            );
          } else {
            // sum (default)
            unitAggregations.push(
              `SUM(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
            );
          }
        } else if (normalizedValue.valueType === "max") {
          // For max, calculate MAX per unit
          unitAggregations.push(
            `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
          );
        } else if (normalizedValue.valueType === "count_distinct") {
          // For count distinct, calculate COUNT(DISTINCT) per unit
          unitAggregations.push(
            `COUNT(DISTINCT ${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
          );
        } else if (normalizedValue.valueType === "unit_count") {
          // Check if this has aggregate filter settings
          if (normalizedValue.aggregateFilterSettings) {
            // Use getAggregateFilters to convert aggregateFilter to SQL conditions
            // We need to create a mock ColumnRef for getAggregateFilters
            const mockColumnRef = {
              aggregateFilter:
                normalizedValue.aggregateFilterSettings.aggregateFilter,
              aggregateFilterColumn:
                normalizedValue.aggregateFilterSettings.aggregateFilterColumn,
              column: normalizedValue.valueColumn || "$$distinctUsers",
            };
            const aggregateFilters = getAggregateFilters({
              columnRef: mockColumnRef,
              column:
                normalizedValue.aggregateFilterSettings.aggregateFilterColumn,
              ignoreInvalid: true,
            });

            if (aggregateFilters.length > 0) {
              // Apply aggregate filter: SUM the column and check the condition
              // Replace the column name in the filter with SUM(prefix_value)
              const sumExpr = `SUM(${normalizedValue.prefix}_value)`;
              const colName =
                normalizedValue.aggregateFilterSettings.aggregateFilterColumn;
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
                `CASE WHEN ${filterConditions} THEN 1 ELSE NULL END as ${normalizedValue.prefix}_value`,
              );
            } else {
              // Fallback if filters couldn't be parsed
              unitAggregations.push(
                `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
              );
            }
          } else {
            // Standard unit count without aggregate filter
            unitAggregations.push(
              `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
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

      const unitCTE = `  _factTable${primarySourceIndex}_unit0 AS (
    SELECT
      ${unitGroupBy.split(", ").join(",\n      ")},
      ${unitAggregations.join(",\n      ")}
    FROM _factTable${primarySourceIndex}_rows
    GROUP BY ${unitGroupBy}
  )`;

      ctes.push(unitCTE);

      // Generate unit rollup CTE
      const unitRollupSelects: string[] = [];
      config.dimensions.forEach((_, idx) => {
        unitRollupSelects.push(`dimension${idx}`);
      });
      values.forEach((normalizedValue) => {
        const source = sources[normalizedValue.sourceIndex];
        const factTable = source?.factTable || null;
        const metric = generateMetricValueExpressionFromNormalized(
          normalizedValue,
          factTable,
          helpers,
        );
        // Unit-level aggregations
        if (metric.isUnitCount && metric.unitColumn) {
          if (normalizedValue.quantileSettings?.type === "unit") {
            // For unit quantiles, calculate the quantile of unit values
            const quantile = normalizedValue.quantileSettings.quantile;
            unitRollupSelects.push(
              `${helpers.percentileApprox(`${normalizedValue.prefix}_value`, quantile)} as ${normalizedValue.prefix}_value`,
            );
          } else {
            // Other unit-level aggregations (unit_count, max, count_distinct) are summed in rollup
            unitRollupSelects.push(
              `SUM(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
            );
          }
        } else {
          unitRollupSelects.push(`NULL as ${normalizedValue.prefix}_value`);
        }
        // Check if this is a denominator (ratio metrics have separate entries)
        if (normalizedValue.isDenominator) {
          // Denominator is handled separately, skip
        }
      });

      const unitRollupCTE = `  _factTable${primarySourceIndex}_unit0_rollup AS (
    SELECT
      ${unitRollupSelects.join(",\n      ")}
    FROM _factTable${primarySourceIndex}_unit0
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
  values.forEach((normalizedValue) => {
    const source = sources[normalizedValue.sourceIndex];
    const factTable = source?.factTable || null;
    const metric = generateMetricValueExpressionFromNormalized(
      normalizedValue,
      factTable,
      helpers,
    );
    if (metric.isUnitCount) {
      eventRollupSelects.push(`NULL as ${normalizedValue.prefix}_value`);
    } else if (metric.isDistinctCount) {
      eventRollupSelects.push(
        `COUNT(DISTINCT ${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
      );
    } else if (metric.isQuantile) {
      const quantile = normalizedValue.quantileSettings?.quantile || 0.9;
      eventRollupSelects.push(
        `${helpers.percentileApprox(`${normalizedValue.prefix}_value`, quantile)} as ${normalizedValue.prefix}_value`,
      );
    } else if (normalizedValue.valueType === "max") {
      eventRollupSelects.push(
        `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
      );
    } else {
      eventRollupSelects.push(
        `SUM(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
      );
    }
  });

  const eventRollupCTE = `  _factTable${primarySourceIndex}_event_rollup AS (
    SELECT
      ${eventRollupSelects.join(",\n      ")}
    FROM _factTable${primarySourceIndex}_rows
    GROUP BY ${config.dimensions.map((_, idx) => `dimension${idx}`).join(", ")}
  )`;

  ctes.push(eventRollupCTE);

  // Generate combined rollup CTE
  const rollupCTEs: string[] = [];
  if (unitColumns.size > 0) {
    rollupCTEs.push(`_factTable${primarySourceIndex}_unit0_rollup`);
  }
  rollupCTEs.push(`_factTable${primarySourceIndex}_event_rollup`);

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
  values.forEach((normalizedValue) => {
    const source = sources[normalizedValue.sourceIndex];
    const factTable = source?.factTable || null;
    const metric = generateMetricValueExpressionFromNormalized(
      normalizedValue,
      factTable,
      helpers,
    );
    if (metric.isQuantile) {
      finalSelects.push(
        `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
      );
    } else if (normalizedValue.valueType === "max") {
      finalSelects.push(
        `MAX(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
      );
    } else {
      finalSelects.push(
        `SUM(${normalizedValue.prefix}_value) as ${normalizedValue.prefix}_value`,
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
