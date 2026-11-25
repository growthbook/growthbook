// SQL building blocks shared by every Product Analytics query kind (metric
// explorations, funnels, journeys): fact table basics, date ranges, row
// filters and dimension expressions.
import { getValidDate } from "shared/dates";
import { buildMinimalOrCondition, quoteColumnIdentifier } from "shared/sql";
import { SqlDialect } from "shared/types/sql";
import { RowFilter, FactTableInterface } from "shared/types/fact-table";
import {
  ProductAnalyticsDimension,
  ProductAnalyticsDynamicDimension,
  ProductAnalyticsStaticDimension,
  ExplorationConfig,
  dateGranularity,
} from "../../validators/product-analytics";
import {
  getRowFilterSQL,
  getColumnExpression,
  getFactTableTimestampColumn,
} from "../../experiments/experiments";
import { hasTimestampColumn } from "./utils";

export type MinimalFactTable = Pick<
  FactTableInterface,
  "sql" | "columns" | "filters" | "userIdTypes" | "userIdColumns"
> & {
  // SQL explorations may omit a timestamp (non-time-series). Fact tables
  // still default missing columns to "timestamp" in toMinimalFactTable.
  timestampColumn: string | null;
  quoteTimestampColumn: boolean;
};

export function toMinimalFactTable(
  factTable: FactTableInterface,
): MinimalFactTable {
  return {
    ...factTable,
    timestampColumn: getFactTableTimestampColumn(factTable),
    quoteTimestampColumn: false,
  };
}

export function getTimestampColumnExpression(
  factTable: MinimalFactTable,
  helpers: SqlDialect,
): string | null {
  if (!hasTimestampColumn(factTable.timestampColumn)) {
    return factTable.quoteTimestampColumn ? null : "timestamp";
  }
  if (!factTable.quoteTimestampColumn) return factTable.timestampColumn;

  return quoteColumnIdentifier(factTable.timestampColumn, helpers);
}

export interface CTE {
  name: string;
  sql: string;
}
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * A `customLookback` value only describes a window when it is a positive
 * number. Zero, negatives and non-finite values are treated as absent.
 */
export function isPositiveLookbackValue(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Start of the UTC calendar day `daysBack` days before today. Rolling presets are
 * inclusive of both end days, so "past N days" passes `N - 1`. Subtracting a raw
 * N without truncating leaves the start at the current time-of-day, which touches
 * N + 1 calendar days and renders as N + 1 day buckets.
 */
function startOfUtcDaysAgo(daysBack: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Start of the inclusive window covering the last `months` calendar months. Steps
 * back `months` then forward a day, since anchoring on the same day-of-month
 * would span `months` *and* a day.
 */
function startOfUtcMonthsAgo(months: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function isRollingDateRange(
  dateRange: ExplorationConfig["dateRange"],
): boolean {
  return (
    dateRange.predefined !== "yesterday" &&
    dateRange.predefined !== "lastCalendarYear" &&
    dateRange.predefined !== "customDateRange"
  );
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
    case "yesterday": {
      // A complete day, unlike `today` which runs up to "now".
      startDate.setUTCDate(startDate.getUTCDate() - 1);
      startDate.setUTCHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(startDate);
      yesterdayEnd.setUTCHours(23, 59, 59, 999);
      return { startDate, endDate: yesterdayEnd };
    }
    case "last7Days":
      return { startDate: startOfUtcDaysAgo(6), endDate };
    case "last30Days":
      return { startDate: startOfUtcDaysAgo(29), endDate };
    case "last90Days":
      return { startDate: startOfUtcDaysAgo(89), endDate };
    case "last12Months":
      return { startDate: startOfUtcMonthsAgo(12), endDate };
    case "lastCalendarYear": {
      // The whole prior calendar year — fixed until the year rolls over.
      const year = startDate.getUTCFullYear() - 1;
      return {
        startDate: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      };
    }
    case "customLookback": {
      // A negative or non-finite lookback would move the start date past the
      // end and produce an inverted window, so anything that isn't a positive
      // number falls back to the 30-day default alongside a missing value.
      if (
        !isPositiveLookbackValue(dateRange.lookbackValue) ||
        !dateRange.lookbackUnit
      ) {
        return { startDate: startOfUtcDaysAgo(29), endDate };
      }
      const unit = dateRange.lookbackUnit;
      const value = dateRange.lookbackValue;
      if (unit === "hour") {
        // Sub-day windows stay on instants; truncating would widen "past 6
        // hours" to everything since midnight.
        startDate.setUTCHours(startDate.getUTCHours() - value);
        return { startDate, endDate };
      }
      if (unit === "day") {
        return { startDate: startOfUtcDaysAgo(value - 1), endDate };
      }
      if (unit === "week") {
        return { startDate: startOfUtcDaysAgo(value * 7 - 1), endDate };
      }
      return { startDate: startOfUtcMonthsAgo(value), endDate };
    }
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

/** Date granularities valid for a resolved date range (for filtering dropdown
 * options and for `sanitizeDimensions`). A granularity is valid if
 * `getDateGranularity` returns it unchanged (or, for "auto", always valid). */
export function getValidDateGranularities(
  dateRange: DateRange,
): (typeof dateGranularity)[number][] {
  return dateGranularity.filter(
    (g) => g === "auto" || getDateGranularity(g, dateRange) === g,
  );
}

// Generate row filter SQL
export function generateRowFilterSQL(
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
        identifierQuote: helpers.identifierQuote,
      });
      return sql;
    })
    .filter((sql): sql is string => sql !== null);
}

/**
 * Scan-level WHERE for several row-filter groups (metrics, funnel steps)
 * reading the same fact table: the minimal OR of the groups. "" means no
 * pushdown (some group is unfiltered, so every row is needed).
 */
export function generatePushdownFilterSQL(
  rowFilterGroups: RowFilter[][],
  factTable: MinimalFactTable,
  helpers: SqlDialect,
): string {
  return buildMinimalOrCondition(
    rowFilterGroups.map((filters) =>
      generateRowFilterSQL(filters, factTable, helpers),
    ),
  );
}

// Dimension values are compared against string literals — the 'other' fallback
// and pinned values — so a non-string column has to be cast to match. String
// columns are left alone so existing SQL, and the predicate pushdown a bare
// column still allows, are unchanged.
export function castDimensionValueToString(
  columnExpr: string,
  column: string,
  factTable: MinimalFactTable,
  helpers: SqlDialect,
): string {
  const [head, ...rest] = column.split(".");
  const col = factTable.columns.find((c) => c.column === head);
  const datatype =
    rest.length > 0 && col?.datatype === "json"
      ? col.jsonFields?.[rest.join(".")]?.datatype
      : col?.datatype;
  // An unresolved column keeps today's behaviour rather than guessing.
  return datatype && datatype !== "string"
    ? helpers.castToString(columnExpr)
    : columnExpr;
}

// Build `column IN (...)` clauses for every static (pinned-values) dimension,
// so callers can drop rows outside the pinned list before aggregation.
export function getStaticDimensionFilters(
  dimensions: ProductAnalyticsDimension[],
  factTable: MinimalFactTable,
  helpers: SqlDialect,
): string[] {
  const staticDimensions = dimensions.filter(
    (d): d is ProductAnalyticsStaticDimension =>
      d.dimensionType === "static" && d.values.length > 0,
  );

  return staticDimensions.map((d) => {
    const columnExpr = getColumnExpression(
      d.column,
      factTable,
      helpers.jsonExtract,
    );
    const valueList = d.values
      .map((v) => `'${helpers.escapeStringLiteral(v)}'`)
      .join(", ");
    return `${castDimensionValueToString(
      columnExpr,
      d.column,
      factTable,
      helpers,
    )} IN (${valueList})`;
  });
}

// Generate dimension expression
export function generateDimensionExpression(
  dimension: ProductAnalyticsDimension,
  dimensionIndex: number,
  factTableGroup: { factTable: MinimalFactTable },
  helpers: SqlDialect,
  dateRange: DateRange,
): string {
  const factTable = factTableGroup.factTable;
  switch (dimension.dimensionType) {
    case "date": {
      const timestampColumn = getTimestampColumnExpression(factTable, helpers);
      if (!timestampColumn) {
        throw new Error("Date dimensions require a timestamp column");
      }
      const granularity = getDateGranularity(
        dimension.dateGranularity,
        dateRange,
      );
      return `${helpers.dateTrunc(timestampColumn, granularity)}`;
    }
    case "dynamic": {
      const topCTE = `_dimension${dimensionIndex}_top`;
      const columnExpr = castDimensionValueToString(
        getColumnExpression(
          dimension.column || "",
          factTable,
          helpers.jsonExtract,
          "",
          helpers.identifierQuote,
        ),
        dimension.column || "",
        factTable,
        helpers,
      );
      return `CASE 
        WHEN ${columnExpr} IN (SELECT value FROM ${topCTE}) THEN ${columnExpr}
        ELSE 'other'
      END`;
    }
    case "static": {
      // Rows outside the pinned value list are dropped entirely (filtered in
      // generateFactTableCTE / buildFunnelSql), so this is just the raw
      // column — no CASE/'other' fallback needed.
      return getColumnExpression(
        dimension.column,
        factTable,
        helpers.jsonExtract,
        "",
        helpers.identifierQuote,
      );
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

// Generate dynamic dimension CTE
export function generateDynamicDimensionCTE(
  factTableGroup: { factTable: MinimalFactTable },
  dimension: ProductAnalyticsDynamicDimension,
  dimensionIndex: number,
  sourceCTE: CTE,
  helpers: SqlDialect,
): CTE {
  const cteName = `_dimension${dimensionIndex}_top`;

  // Must match generateDimensionExpression's cast, or the IN never hits.
  const columnExpr = castDimensionValueToString(
    getColumnExpression(
      dimension.column || "",
      factTableGroup.factTable,
      helpers.jsonExtract,
      "",
      helpers.identifierQuote,
    ),
    dimension.column || "",
    factTableGroup.factTable,
    helpers,
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
