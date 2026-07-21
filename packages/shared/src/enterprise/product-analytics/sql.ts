import { getValidDate } from "shared/dates";
import { buildMinimalOrCondition, format } from "shared/sql";
import {
  buildManagedWarehouseAttributeAliasClause,
  MANAGED_WAREHOUSE_EVENTS_TABLE,
  MANAGED_WAREHOUSE_EXPERIMENT_VIEWS_TABLE,
} from "shared/util";
import { SqlDialect } from "shared/types/sql";
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
import { DataSourceSettings, DataSourceType } from "shared/types/datasource";
import {
  ProductAnalyticsDimension,
  ProductAnalyticsDynamicDimension,
  FactTableDataset,
  ExplorationConfig,
  DataSourceDataset,
  ProductAnalyticsResult,
  ProductAnalyticsResultRow,
  FunnelDataset,
  FunnelStep,
  ConversionWindow,
} from "../../validators/product-analytics";
import {
  getRowFilterSQL,
  getColumnExpression,
  getAggregateFilters,
} from "../../experiments/experiments";

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
  type?: string;
  settings?: DataSourceSettings | null;
}

// Per-org managed-warehouse tables that carry the `attributes` JSON column, so a
// `data_source` exploration querying one directly can be given the same column aliases
// the fact table uses. Matches the table-name suffix (the information-schema path may be
// db-qualified / backtick-quoted).
const MANAGED_WAREHOUSE_PER_ORG_TABLES = new Set<string>([
  MANAGED_WAREHOUSE_EVENTS_TABLE,
  MANAGED_WAREHOUSE_EXPERIMENT_VIEWS_TABLE,
]);
function isManagedWarehousePerOrgTable(path: string): boolean {
  const table = path.replace(/`/g, "").split(".").pop()?.trim().toLowerCase();
  return table !== undefined && MANAGED_WAREHOUSE_PER_ORG_TABLES.has(table);
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

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
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
  values: FactTableDataset["values"] | DataSourceDataset["values"],
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
  datasource,
}: {
  config: ExplorationConfig;
  factTableMap: FactTableMap;
  metricMap: Map<string, FactMetricInterface>;
  datasource: MinimalDatasourceInterface;
}): FactTableGroup[] {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }
  const datasourceSettings = datasource.settings || null;

  switch (config.dataset.type) {
    case "data_source": {
      // For a migrated managed warehouse, re-expose former materialized columns as
      // top-level aliases (same as the fact table) so bare references in a raw
      // `data_source` exploration keep resolving. No-op for legacy/other datasources.
      const aliasClause =
        datasource.type === "growthbook_clickhouse" &&
        isManagedWarehousePerOrgTable(config.dataset.path)
          ? buildManagedWarehouseAttributeAliasClause(datasourceSettings)
          : "";
      return [
        {
          index: 0,
          factTable: createStubFactTable(
            `SELECT *${aliasClause} FROM ${config.dataset.path}`,
            config.dataset.timestampColumn,
            config.dataset.columnTypes,
            datasourceSettings,
          ),
          ...getMetricsAndUnitsFromValues(config.dataset.values),
        },
      ];
    }
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
    case "funnel":
      // Funnels are dispatched away from this code path in
      // generateProductAnalyticsSQL; this branch exists only so the switch
      // is exhaustive over the dataset type union.
      throw new Error("Funnel datasets are not handled by getFactTableGroups");
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
  dateRange: ExplorationConfig["dateRange"],
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
    case "customDateRange": {
      // The user picked calendar days, not instants, so expand the start to
      // `00:00:00.000` UTC and the end to `23:59:59.999` UTC. Without the
      // end-of-day expansion, picking "Apr 1 → May 1" would silently drop
      // everything that happened on May 1.
      const startDate = getValidDate(dateRange.startDate);
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = getValidDate(dateRange.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
      return { startDate, endDate };
    }
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
  helpers: SqlDialect,
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
        stringMatch: helpers.stringMatch,
        jsonExtract: helpers.jsonExtract,
        evalBoolean: helpers.evalBoolean,
        castToTimestamp: helpers.castToTimestamp,
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
  helpers: SqlDialect,
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
        dimension.column || "",
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
  helpers: SqlDialect,
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

function getUnitAggregationExpr(
  columnRef: ColumnRef,
  alias: string,
  helpers: SqlDialect,
): string {
  if (columnRef.column === "$$distinctDates") {
    return `COUNT(DISTINCT ${alias})`;
  }
  if (columnRef.column === "$$distinctUsers") {
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
  }
  if (columnRef.column === "$$count") {
    return `SUM(${alias})`;
  }

  const aggregation = columnRef.aggregation;
  switch (aggregation) {
    case "sum":
      return `SUM(${alias})`;
    case "max":
      return `MAX(${alias})`;
    case "count distinct":
      return `COUNT(DISTINCT ${alias})`;
    case "hll merge":
      return helpers.hllCardinality(helpers.hllReaggregate(alias));
    case "kll merge":
      return helpers.quantileSketchMergePartial(alias);
    case undefined:
      return `SUM(${alias})`;
  }

  return assertNever(aggregation);
}

function getRollupAggregationExpr(
  metric: MinimalMetric,
  columnRef: ColumnRef,
  alias: string,
  helpers: SqlDialect,
  fromUnitAggregation: boolean,
): string {
  if (columnRef.aggregation === "hll merge") {
    return fromUnitAggregation
      ? `SUM(${alias})`
      : helpers.hllCardinality(helpers.hllReaggregate(alias));
  }

  // Quantiles
  if (metric.metricType === "quantile" && metric.quantileSettings) {
    if (columnRef.aggregation === "kll merge") {
      return helpers.quantileSketchExtractPoint(
        helpers.quantileSketchMergePartial(alias),
        metric.quantileSettings.quantile,
      );
    }
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
  helpers: SqlDialect,
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

  // Always expose a denominator (unit count) for unit-aggregated non-ratio,
  // non-quantile metrics so the frontend can render either the raw numerator
  // (totals) or numerator/denominator (per-unit averages) based on the
  // chart-level `showAs` setting.
  //
  // Intentionally symmetric across dataset types: fact_table/data_source
  // datasets (where `showAsAppliesTo` returns false and the denominator is
  // never surfaced) still emit this column. The extra `COUNT(...)` is cheap
  // relative to the rest of the rollup and keeps the SQL shape / result
  // column set identical regardless of dataset type, which simplifies the
  // downstream parser and test fixtures. If this ever becomes a measurable
  // cost, narrow the guard to metric datasets where per-unit is meaningful.
  let rollupCountExpr: string | null = null;
  if (
    selectedUnit &&
    metric.metricType !== "ratio" &&
    metric.metricType !== "quantile"
  ) {
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
      ? getUnitAggregationExpr(columnRef, alias, helpers)
      : null,
    rollupAggregationExpr: getRollupAggregationExpr(
      metric,
      columnRef,
      alias,
      helpers,
      !!selectedUnit,
    ),
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
  helpers: SqlDialect,
): CTE {
  const cteName = `_dimension${dimensionIndex}_top`;

  const columnExpr = getColumnExpression(
    dimension.column || "",
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
    LIMIT ${Math.min(dimension.maxValues, 20)}
  `,
  };
}

function generatePercentileCapsCTE(
  factTableGroup: FactTableGroup,
  sourceCTE: CTE,
  helpers: SqlDialect,
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
  helpers: SqlDialect,
  dateRange: DateRange,
): CTE {
  const factTable = factTableGroup.factTable;

  const timestampColumn = factTable.timestampColumn || "timestamp";

  const baseSql = factTable.sql;

  // Get a de-duped list of all filters across all metrics
  const allMetricFilters: string[][] = [];
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

    allMetricFilters.push(filterParts);
  });

  const whereClauses: string[] = [];

  // Date range filter
  whereClauses.push(
    `${timestampColumn} >= ${helpers.toTimestamp(dateRange.startDate)} AND ${timestampColumn} <= ${helpers.toTimestamp(dateRange.endDate)}`,
  );

  const metricsFilter = buildMinimalOrCondition(allMetricFilters);
  if (metricsFilter) {
    whereClauses.push(metricsFilter);
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
  helpers: SqlDialect,
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
  aliasesWithDenominator: Set<string>,
  dialect: SqlDialect,
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
    const valueAlias = alias.endsWith("_denominator")
      ? alias
      : `${alias}_numerator`;

    if (metricData && metricData.rollupAggregationExpr) {
      selects.push(
        `${dialect.castToFloat(metricData.rollupAggregationExpr || "NULL")} AS ${valueAlias}`,
      );
      if (aliasesWithDenominator.has(alias)) {
        selects.push(
          `${dialect.castToFloat(metricData.rollupCountExpr ?? "NULL")} AS ${alias}_denominator`,
        );
      }
    } else {
      selects.push(`${dialect.castToFloat("NULL")} AS ${valueAlias}`);
      if (aliasesWithDenominator.has(alias)) {
        selects.push(`${dialect.castToFloat("NULL")} AS ${alias}_denominator`);
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
  aliasesWithDenominator: Set<string>,
  dialect: SqlDialect,
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
    const valueAlias = alias.endsWith("_denominator")
      ? alias
      : `${alias}_numerator`;
    if (metricData && metricData.rollupAggregationExpr) {
      selects.push(
        `${dialect.castToFloat(metricData.rollupAggregationExpr || "NULL")} AS ${valueAlias}`,
      );
      if (aliasesWithDenominator.has(alias)) {
        selects.push(
          `${dialect.castToFloat(metricData.rollupCountExpr ?? "NULL")} AS ${alias}_denominator`,
        );
      }
    } else {
      selects.push(`${dialect.castToFloat("NULL")} AS ${valueAlias}`);
      if (aliasesWithDenominator.has(alias)) {
        selects.push(`${dialect.castToFloat("NULL")} AS ${alias}_denominator`);
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
    const valueAlias = m.alias.endsWith("_denominator")
      ? m.alias
      : `${m.alias}_numerator`;
    selects.push(
      needsReaggregation
        ? `MAX(${valueAlias}) AS ${valueAlias}`
        : `${valueAlias} AS ${valueAlias}`,
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

/* -------------------------------------------------------------------------- */
/* Funnel SQL                                                                 */
/* -------------------------------------------------------------------------- */

const CONVERSION_WINDOW_UNIT_TO_SECONDS: Record<
  ConversionWindow["unit"],
  number
> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 86400 * 7,
};

function conversionWindowToSeconds(window: ConversionWindow): number {
  return (
    Math.max(1, Math.round(window.value)) *
    CONVERSION_WINDOW_UNIT_TO_SECONDS[window.unit]
  );
}

/**
 * Build the chained `COALESCE(stepN_resolved_ts, stepN-1_resolved_ts, ...)`
 * expression we use as the "previous resolved timestamp" for step `index`.
 * Walks backward from `index - 1` and prefers required steps (an optional
 * step that the user skipped falls through to its predecessor).
 */
function buildPrevResolvedExpr(
  steps: FunnelStep[],
  index: number,
  alias: string = "",
): string {
  // Walk back from the immediate predecessor. Optional steps that the user
  // skipped will be NULL, so chaining COALESCE through them lets the next
  // step's window/concurrency be measured against the most recent step the
  // user actually completed.
  const prefix = alias ? `${alias}.` : "";
  const parts: string[] = [];
  for (let i = index - 1; i >= 0; i--) {
    parts.push(`${prefix}step${i + 1}_resolved_ts`);
    if (!steps[i].optional) break;
  }
  if (parts.length === 1) return parts[0];
  return `COALESCE(${parts.join(", ")})`;
}

interface FunnelFactTableGroup {
  index: number;
  factTable: MinimalFactTable;
  // Step indexes (1-based) sourced from this fact table.
  stepIndexes: number[];
}

/**
 * Group funnel steps by fact table id, preserving the order of fact tables
 * as they first appear in the steps array.
 */
function groupFunnelStepsByFactTable(
  steps: FunnelStep[],
  factTableMap: FactTableMap,
): FunnelFactTableGroup[] {
  const groups: Map<string, FunnelFactTableGroup> = new Map();
  steps.forEach((step, idx) => {
    if (!step.factTable) {
      throw new Error(
        `Funnel step ${idx + 1} ("${step.name}") is missing a fact table`,
      );
    }
    const existing = groups.get(step.factTable);
    if (existing) {
      existing.stepIndexes.push(idx + 1);
      return;
    }
    const factTable = factTableMap.get(step.factTable);
    if (!factTable) {
      throw new Error(`Fact table ${step.factTable} not found`);
    }
    groups.set(step.factTable, {
      index: groups.size,
      factTable,
      stepIndexes: [idx + 1],
    });
  });
  return Array.from(groups.values());
}

/**
 * Build SQL for a funnel exploration.
 *
 * The query is structured as:
 *   1. One CTE per fact table referenced by any step. Each row emits
 *      `stepN_ts` columns that are NULL except for the steps the row
 *      qualifies for. Date-range filter is applied here.
 *   2. `__funnel_events` UNIONs the fact-table CTEs into a common shape
 *      (NULLs for non-applicable step columns / dimension column).
 *   3. `__funnel_user_aggregates`: a SINGLE per-user GROUP BY that pulls
 *      step 1's earliest timestamp + first-touch dimension AND materializes
 *      a sorted timestamp array per follow-on step. This is the only place
 *      the full per-event log is scanned for step resolution.
 *   4. Chained `__funnel_resolved_step{N}` CTEs resolve each follow-on
 *      step's timestamp via the dialect's `arrayMinInRange` lookup against
 *      that step's pre-sorted array — one row per user, no joins back to
 *      the raw events. The conversion-window and concurrency-window bounds
 *      live in the array filter predicate.
 *   5. The final SELECT aggregates per dimension: per-step counts +
 *      sum/sum-of-squares of time-from-previous-step (ms).
 */
/**
 * Datasource types whose funnel SQL has been execution-verified and are
 * enabled for the standalone funnel explorer at launch. D-PA2 decision: launch
 * on a validated subset first, then expand as each remaining dialect's funnel
 * SQL is execution-tested (see B1a in the deploy-readiness workplan).
 *
 * Keyed on datasource `type` (not `SqlDialect.formatDialect`): formatDialect is
 * the sql-formatter id and is shared across engines (both Athena and Presto are
 * `"trino"`), so it can't express a per-engine subset. `growthbook_clickhouse`
 * (managed warehouse) and `clickhouse` both use the ClickHouse dialect.
 */
export const FUNNEL_SUPPORTED_DATASOURCE_TYPES: readonly DataSourceType[] = [
  "postgres",
  "clickhouse",
  "growthbook_clickhouse",
  "bigquery",
  "snowflake",
  "athena",
  "presto",
  "databricks",
];

export function isFunnelSupportedDatasourceType(type: DataSourceType): boolean {
  return FUNNEL_SUPPORTED_DATASOURCE_TYPES.includes(type);
}

export function buildFunnelSql(
  config: ExplorationConfig,
  factTableMap: FactTableMap,
  dialect: SqlDialect,
): { sql: string; stepCount: number } {
  if (config.dataset.type !== "funnel") {
    throw new Error("buildFunnelSql called with a non-funnel dataset");
  }
  const dataset: FunnelDataset = config.dataset;
  const steps = dataset.steps;
  if (steps.length < 2) {
    throw new Error("Funnels require at least 2 steps");
  }
  if (!dataset.unit) {
    throw new Error("Funnel unit is required");
  }
  const unit = dataset.unit;
  const concurrencyWindowSeconds = dataset.concurrencyWindowSeconds ?? 0;
  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);
  const ftGroups = groupFunnelStepsByFactTable(steps, factTableMap);

  // Validate that the unit exists on every step's fact table.
  for (const group of ftGroups) {
    if (!group.factTable.userIdTypes.includes(unit)) {
      throw new Error(
        `Funnel unit "${unit}" is not a userIdType on fact table for step(s) ${group.stepIndexes.join(", ")}`,
      );
    }
  }

  // Funnels are capped at 1 dimension (Phase 1) and the dimension must
  // resolve against the initial step's fact table.
  const dimension = config.dimensions[0] ?? null;
  const initialFactTable = factTableMap.get(steps[0].factTable);
  if (!initialFactTable) {
    throw new Error(`Fact table ${steps[0].factTable} not found`);
  }
  const initialFactTableGroup: FactTableGroup = {
    index: 0,
    factTable: initialFactTable,
    metrics: [],
    units: [],
  };
  const dimensionExpr = dimension
    ? generateDimensionExpression(
        dimension,
        0,
        initialFactTableGroup,
        dialect,
        dateRange,
      )
    : null;
  const ctes: CTE[] = [];

  // 1a. Per-fact-table "raw" CTE — wraps the fact table SQL with the date
  // filter and preserves all raw columns so the optional top-N dimension
  // CTE can read the un-classified column.
  ftGroups.forEach((group) => {
    const ft = group.factTable;
    const timestampColumn = ft.timestampColumn || "timestamp";
    const dateFilter = `${timestampColumn} >= ${dialect.toTimestamp(dateRange.startDate)} AND ${timestampColumn} <= ${dialect.toTimestamp(dateRange.endDate)}`;
    ctes.push({
      name: `__funnel_ft${group.index}_raw`,
      sql: `
        SELECT * FROM (
          -- Raw fact table SQL
          ${ft.sql}
        ) t
        WHERE ${dateFilter}
      `,
    });
  });

  // 1b. Optional dynamic-dimension top-N CTE. Built before the events CTE
  // so the inlined dimensionExpr (which references _dimension0_top) is
  // resolvable.
  if (dimension?.dimensionType === "dynamic") {
    const initialRawCte = ctes[0];
    ctes.push(
      generateDynamicDimensionCTE(
        initialFactTableGroup,
        dimension as ProductAnalyticsDynamicDimension,
        0,
        initialRawCte,
        dialect,
      ),
    );
  }

  // 1c. Per-fact-table events CTE — projects user_id, ts, the dimension
  // (only on the initial fact table; later fact tables emit NULL), and one
  // `stepN_ts` column per funnel step (NULL when this fact table doesn't
  // source that step).
  ftGroups.forEach((group) => {
    const ft = group.factTable;
    const timestampColumn = ft.timestampColumn || "timestamp";
    const selectCols: string[] = [
      `${unit} AS user_id`,
      `${timestampColumn} AS ts`,
      // Funnel dimensions are first-touch from the funnel's start, so only
      // the initial fact table contributes a real dimension value. Cast to a
      // string on every fact table (including the typed-NULL placeholder) so
      // the multi-fact-table UNION column types line up — a bare `NULL` is
      // inferred as INT64 on BigQuery / text on Postgres and clashes with the
      // real (string) dimension value. Dimension values are consumed as string
      // labels downstream (transformFunnelRowsToResult → parseStringValue).
      group.stepIndexes.includes(1) && dimensionExpr
        ? `${dialect.castToString(dimensionExpr)} AS dimension_1`
        : `${dialect.castToString("NULL")} AS dimension_1`,
    ];
    steps.forEach((step, idx) => {
      const stepN = idx + 1;
      const colName = `step${stepN}_ts`;
      if (group.stepIndexes.includes(stepN)) {
        const filters = generateRowFilterSQL(step.rowFilters, ft, dialect);
        const filterClause = filters.length
          ? `(${filters.join(" AND ")})`
          : "TRUE";
        selectCols.push(
          `CASE WHEN ${filterClause} THEN ${timestampColumn} END AS ${colName}`,
        );
      } else {
        // Wrap NULL in a typed cast so the multi-fact-table UNION matches
        // up. Postgres infers a bare `NULL` as `text`, which then conflicts
        // with the real timestamp values emitted by other fact tables.
        selectCols.push(`${dialect.castToTimestamp("NULL")} AS ${colName}`);
      }
    });
    ctes.push({
      name: `__funnel_ft${group.index}_events`,
      sql: `
        SELECT
          ${selectCols.join(",\n          ")}
        FROM __funnel_ft${group.index}_raw
      `,
    });
  });

  // 2. Unified events CTE (UNION across fact tables). When only one fact
  // table is involved we point at its events CTE directly for a simpler plan.
  const eventsCTE: CTE =
    ftGroups.length === 1
      ? { name: "__funnel_ft0_events", sql: "" }
      : {
          name: "__funnel_events",
          sql: ftGroups
            .map((g) => `SELECT * FROM __funnel_ft${g.index}_events`)
            .join("\nUNION ALL\n"),
        };
  if (ftGroups.length > 1) ctes.push(eventsCTE);

  // 3. Per-user aggregate CTE. One GROUP BY user_id pass over the unified
  // events table captures everything we need to resolve the funnel:
  //   - step 1's earliest qualifying timestamp (MIN of step1_ts)
  //   - the first-touch dimension (argMin valueCol=dimension_1 by tsCol=step1_ts)
  //   - one sorted timestamp array per follow-on step (stepN_arr) so the
  //     chained CTEs below can look up the next step in-memory.
  //
  // This replaces the old approach of doing one LEFT JOIN back to the full
  // event log per step. The event log gets scanned exactly once here.
  const userAggregateCols: string[] = ["user_id"];
  if (dimensionExpr) {
    userAggregateCols.push(
      `${dialect.argMinByTimestamp("dimension_1", "step1_ts")} AS dimension_1`,
    );
  }
  userAggregateCols.push(`MIN(step1_ts) AS step1_resolved_ts`);
  for (let i = 1; i < steps.length; i++) {
    const stepN = i + 1;
    userAggregateCols.push(
      `${dialect.arrayAggSorted(`step${stepN}_ts`)} AS step${stepN}_arr`,
    );
  }
  const userAggregatesCte: CTE = {
    name: "__funnel_user_aggregates",
    sql: `
      SELECT
        ${userAggregateCols.join(",\n        ")}
      FROM ${eventsCTE.name}
      GROUP BY user_id
    `,
  };
  ctes.push(userAggregatesCte);

  // 3b. Chained step-N resolution. Each CTE reads directly from the
  // previous one — the prev CTE already carries `stepN_arr` forward from
  // __funnel_user_aggregates, so a JOIN back to the aggregate would be
  // a redundant self-join on user_id. Each step "consumes" its own array
  // column (replacing it with `stepN_resolved_ts`) and forwards the
  // remaining arrays for later steps.
  let prevCte: CTE = userAggregatesCte;
  const carriedCols: string[] = [];
  if (dimensionExpr) carriedCols.push("dimension_1");
  carriedCols.push("step1_resolved_ts");
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const stepN = i + 1;
    const prevExpr = buildPrevResolvedExpr(steps, i, "r");
    const windowSeconds = step.conversionWindow
      ? conversionWindowToSeconds(step.conversionWindow)
      : null;
    const lowerBound =
      concurrencyWindowSeconds > 0
        ? dialect.addIntervalSeconds(prevExpr, "-", concurrencyWindowSeconds)
        : prevExpr;
    const upperBound =
      windowSeconds != null
        ? dialect.addIntervalSeconds(prevExpr, "+", windowSeconds)
        : null;
    const selectCols: string[] = ["r.user_id"];
    for (const c of carriedCols) selectCols.push(`r.${c}`);
    selectCols.push(
      `${dialect.arrayMinInRange(`r.step${stepN}_arr`, lowerBound, upperBound)} AS step${stepN}_resolved_ts`,
    );
    // Forward arrays that subsequent step CTEs still need to consume.
    for (let j = i + 1; j < steps.length; j++) {
      selectCols.push(`r.step${j + 1}_arr`);
    }
    const cte: CTE = {
      name: `__funnel_resolved_step${stepN}`,
      sql: `
        SELECT
          ${selectCols.join(",\n          ")}
        FROM ${prevCte.name} r
      `,
    };
    ctes.push(cte);
    carriedCols.push(`step${stepN}_resolved_ts`);
    prevCte = cte;
  }

  // 4. Final aggregation: counts + time-from-previous stats per step.
  const finalSelects: string[] = [];
  const finalGroupBys: string[] = [];
  if (dimensionExpr) {
    finalSelects.push("dimension_1");
    finalGroupBys.push("dimension_1");
  }
  steps.forEach((_step, i) => {
    const stepN = i + 1;
    finalSelects.push(
      `${dialect.castToFloat(`COUNT(step${stepN}_resolved_ts)`)} AS step${stepN}_count`,
    );
    if (i > 0) {
      const prevExpr = buildPrevResolvedExpr(steps, i);
      // Express the diff in hours so the sum-of-squares stays well below
      // MAX_SAFE_INTEGER at scale. Millisecond-precision squares overflow
      // JS numbers with only a few thousand users.
      const diffExpr = `(${dialect.castToFloat(dialect.dateDiffMs(prevExpr, `step${stepN}_resolved_ts`))} / 3600000)`;
      finalSelects.push(
        `SUM(CASE WHEN step${stepN}_resolved_ts IS NOT NULL THEN ${diffExpr} END) AS step${stepN}_tfp_sum_hrs`,
      );
      finalSelects.push(
        `SUM(CASE WHEN step${stepN}_resolved_ts IS NOT NULL THEN ${diffExpr} * ${diffExpr} END) AS step${stepN}_tfp_sum_sq_hrs`,
      );
    }
  });

  const finalSelect = `
    SELECT
      ${finalSelects.join(",\n      ")}
    FROM ${prevCte.name}
    WHERE step1_resolved_ts IS NOT NULL
    ${finalGroupBys.length ? `GROUP BY ${finalGroupBys.join(", ")}` : ""}
  `;

  const sql = format(
    `
    WITH
      ${ctes.map((c) => `${c.name} AS (\n${c.sql}\n)`).join(",\n      ")}
    ${finalSelect}
    `,
    dialect.formatDialect,
  );

  return { sql, stepCount: steps.length };
}

/**
 * Parse warehouse rows produced by `buildFunnelSql` into the funnel result
 * shape. Each input row carries `dimension_1` (if a dimension was set) plus
 * `step{N}_count`, `step{N}_tfp_sum_hrs`, `step{N}_tfp_sum_sq_hrs` columns.
 */
export function transformFunnelRowsToResult(
  config: ExplorationConfig,
  rows: Record<string, unknown>[],
): ProductAnalyticsResult {
  if (config.dataset.type !== "funnel") {
    throw new Error(
      "transformFunnelRowsToResult called with non-funnel config",
    );
  }
  const steps = config.dataset.steps;
  const hasDimension = config.dimensions.length > 0;
  const result: ProductAnalyticsResult = { rows: [] };

  for (const row of rows) {
    const resultRow: ProductAnalyticsResultRow = {
      dimensions: hasDimension ? [parseStringValue(row["dimension_1"])] : [],
      steps: steps.map((_step, i) => {
        const stepN = i + 1;
        return {
          count: parseNumberValue(row[`step${stepN}_count`]) ?? 0,
          timeFromPrevSumHrs:
            i === 0 ? null : parseNumberValue(row[`step${stepN}_tfp_sum_hrs`]),
          timeFromPrevSumSquaresHrs:
            i === 0
              ? null
              : parseNumberValue(row[`step${stepN}_tfp_sum_sq_hrs`]),
        };
      }),
    };
    result.rows.push(resultRow);
  }

  return result;
}

/* -------------------------------------------------------------------------- */

export function generateProductAnalyticsSQL(
  config: ExplorationConfig,
  factTableMap: FactTableMap,
  metricMap: Map<string, FactMetricInterface>,
  dialect: SqlDialect,
  datasource: MinimalDatasourceInterface,
): {
  sql: string;
  orderedMetricIds: string[];
} {
  if (!config.dataset) {
    throw new Error("Dataset is required");
  }

  // Funnels have a structurally different query (chained per-step CTEs
  // instead of per-fact-table rollups), so dispatch early.
  if (config.dataset.type === "funnel") {
    const { sql } = buildFunnelSql(config, factTableMap, dialect);
    return { sql, orderedMetricIds: [] };
  }

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  const factTableGroups = getFactTableGroups({
    config,
    factTableMap,
    metricMap,
    datasource,
  });

  // Get all metric aliases
  const allMetrics: MetricData[] = [];
  const orderedMetricIds: string[] = [];
  factTableGroups.forEach((f) => {
    f.metrics.forEach((m) => {
      const data = getMetricData(m, f.factTable, dialect);
      allMetrics.push(data);
      // For ratio metrics, we only need to add the numerator since it's the same metric id
      if (!m.useDenominator) orderedMetricIds.push(m.metric.id);
    });
  });

  const allMetricsAliases: string[] = allMetrics.map((m) => m.alias);
  const aliasesWithDenominator: Set<string> = new Set(
    allMetrics.filter((m) => m.rollupCountExpr).map((m) => m.alias),
  );

  // Get all dimensions
  const allDimensions: DimensionData[] = [];
  config.dimensions.forEach((d, i) => {
    allDimensions.push({
      alias: `dimension${i}`,
      valueExpr: generateDimensionExpression(
        d,
        i,
        factTableGroups[0],
        dialect,
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
      dialect,
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
            dialect,
          );
          ctes.push(dynamicDimensionCTE);
        }
      });
    }

    // If there are percentile caps, add the percentile caps CTE
    const percentileCapsCTE = generatePercentileCapsCTE(
      factTableGroup,
      factTableCTE,
      dialect,
    );
    if (percentileCapsCTE) ctes.push(percentileCapsCTE);

    // Add the fact table rows CTE
    const factTableRowsCTE = generateFactTableRowsCTE(
      factTableGroup,
      factTableCTE,
      percentileCapsCTE,
      allDimensions,
      dialect,
    );
    ctes.push(factTableRowsCTE);

    // Split metrics into unit/event groups
    const unitMetrics: Record<string, MetricData[]> = {};
    const eventMetrics: MetricData[] = [];
    factTableGroup.metrics.forEach((m) => {
      const metricData = getMetricData(m, factTableGroup.factTable, dialect);
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
        aliasesWithDenominator,
        dialect,
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
        aliasesWithDenominator,
        dialect,
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
    dialect.formatDialect,
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
  config: ExplorationConfig,
  rows: Record<string, unknown>[],
  orderedMetricIds: string[],
): ProductAnalyticsResult {
  // Funnels emit `step{N}_*` columns instead of metric columns and carry
  // results in `row.steps` instead of `row.values`. Delegate to the
  // funnel-specific parser.
  if (config.dataset.type === "funnel") {
    return transformFunnelRowsToResult(config, rows);
  }

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
      resultRow.values?.push({
        metricId,
        numerator: parseNumberValue(row[aliases.numerator]),
        denominator: parseNumberValue(row[aliases.denominator]),
      });
    });
  }

  return result;
}
