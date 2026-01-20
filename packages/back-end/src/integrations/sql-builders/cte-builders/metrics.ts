/**
 * Metric CTE Builder
 *
 * Pure functions for generating metric SQL CTEs.
 * Extracted from SqlIntegration.ts for better testability and reuse.
 *
 * Metrics are used to measure the impact of experiments. They can be:
 * - Legacy metrics (SQL-based or query builder)
 * - Fact metrics (based on fact tables with filters)
 *
 * The CTE builders handle:
 * - SQL generation for different metric types
 * - Identity joins when metric uses different user ID type
 * - Date filtering and template variable substitution
 * - Fact table filters and column expressions
 */

import {
  ExperimentMetricInterface,
  isFactMetric,
  getUserIdTypes,
  getMetricTemplateVariables,
  getColumnRefWhereClause,
  parseSliceMetricId,
  isRatioMetric,
} from "shared/experiments";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { PhaseSQLVar } from "shared/types/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Interface for SQL generation methods needed by metric CTE builder.
 */
export interface MetricCTEDialect {
  /** Cast a user-provided date column to the appropriate datetime type */
  castUserDateCol(column: string): string;

  /** Convert a Date to a SQL timestamp expression */
  toTimestamp(date: Date): string;

  /** Convert a Date to a SQL timestamp with millisecond precision */
  toTimestampWithMs(date: Date): string;

  /** Get the database schema prefix (if any) */
  getSchema(): string;

  /** Escape a string literal for SQL */
  escapeStringLiteral(value: string): string;

  /** Extract a field from a JSON column */
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string;

  /** Evaluate a boolean expression in SQL */
  evalBoolean(value: boolean): string;

  /** Get metric query format ('sql', 'builder', or 'fact') */
  getMetricQueryFormat(metric: ExperimentMetricInterface): "sql" | "builder";

  /** Get metric columns (userIds, timestamp, value) */
  getMetricColumns(
    metric: ExperimentMetricInterface,
    factTableMap: FactTableMap,
    alias: string,
    useDenominator?: boolean
  ): {
    userIds: Record<string, string>;
    timestamp: string;
    value: string;
  };

  /** Get fact metric column expression */
  getFactMetricColumn(
    metric: FactMetricInterface,
    columnRef: FactMetricInterface["numerator"],
    factTable: FactTableInterface,
    alias: string
  ): { value: string };
}

/**
 * Parameters for building a metric CTE.
 */
export interface MetricCTEParams {
  /** The metric to build a CTE for */
  metric: ExperimentMetricInterface;

  /** The base user ID type for the query */
  baseIdType: string;

  /** Map from user ID types to their identity join table names */
  idJoinMap: Record<string, string>;

  /** Start date for metric data */
  startDate: Date;

  /** End date for metric data (null means no upper bound) */
  endDate: Date | null;

  /** Optional experiment ID for template variables */
  experimentId?: string;

  /** Map of fact tables by ID */
  factTableMap: FactTableMap;

  /** Whether to use denominator for ratio metrics */
  useDenominator?: boolean;

  /** Optional phase information for template variables */
  phase?: PhaseSQLVar;

  /** Optional custom fields for template variables */
  customFields?: Record<string, unknown>;
}

/**
 * Parameters for building a fact metric CTE.
 */
export interface FactMetricCTEParams {
  /** Array of metrics with their indices for column naming */
  metricsWithIndices: { metric: FactMetricInterface; index: number }[];

  /** The fact table to query */
  factTable: FactTableInterface;

  /** The base user ID type for the query */
  baseIdType: string;

  /** Map from user ID types to their identity join table names */
  idJoinMap: Record<string, string>;

  /** Start date for metric data */
  startDate: Date;

  /** End date for metric data (null means no upper bound) */
  endDate: Date | null;

  /** Optional experiment ID for template variables */
  experimentId?: string;

  /** Whether to add metric filters to WHERE clause */
  addFiltersToWhere?: boolean;

  /** Optional phase information for template variables */
  phase?: PhaseSQLVar;

  /** Optional custom fields for template variables */
  customFields?: Record<string, unknown>;

  /** Use exclusive (>) start date filter instead of inclusive (>=) */
  exclusiveStartDateFilter?: boolean;

  /** Use exclusive (<) end date filter instead of inclusive (<=) */
  exclusiveEndDateFilter?: boolean;

  /** Cast ID column to string */
  castIdToString?: boolean;
}

/**
 * Build a metric CTE for calculating metric values.
 *
 * This function generates SQL for querying metric data, handling:
 * - Different metric formats (SQL, builder, fact)
 * - Identity joins when needed
 * - Date filtering
 * - Template variable substitution
 *
 * @param dialect - SQL dialect implementation
 * @param params - Parameters including metric, dates, and fact tables
 * @returns SQL string for the metric CTE body
 */
export function buildMetricCTE(
  dialect: MetricCTEDialect,
  params: MetricCTEParams
): string {
  const {
    metric,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    factTableMap,
    useDenominator,
    phase,
    customFields,
  } = params;

  const cols = dialect.getMetricColumns(
    metric,
    factTableMap,
    "m",
    useDenominator
  );

  // Determine the identifier column to select from
  let userIdCol = cols.userIds[baseIdType] || "user_id";
  let join = "";

  const userIdTypes = getUserIdTypes(metric, factTableMap, useDenominator);

  const isFact = isFactMetric(metric);
  const queryFormat = isFact ? "fact" : dialect.getMetricQueryFormat(metric);
  const columnRef = isFact
    ? useDenominator
      ? metric.denominator
      : metric.numerator
    : null;

  // For fact metrics with a WHERE clause
  const factTable = isFact
    ? factTableMap.get(columnRef?.factTableId || "")
    : undefined;

  if (isFact && !factTable) {
    throw new Error("Could not find fact table");
  }

  // Query builder does not use a sub-query to get the userId column to
  // equal the userIdType, so when using the query builder, continue to
  // use the actual input column name rather than the id type
  if (userIdTypes.includes(baseIdType)) {
    userIdCol = queryFormat === "builder" ? userIdCol : baseIdType;
  } else if (userIdTypes.length > 0) {
    for (let i = 0; i < userIdTypes.length; i++) {
      const userIdType: string = userIdTypes[i];
      if (userIdType in idJoinMap) {
        const metricUserIdCol =
          queryFormat === "builder"
            ? cols.userIds[userIdType]
            : `m.${userIdType}`;
        join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
        userIdCol = `i.${baseIdType}`;
        break;
      }
    }
  }

  // BQ datetime cast for SELECT statements (do not use for where)
  const timestampDateTimeColumn = dialect.castUserDateCol(cols.timestamp);

  const schema = dialect.getSchema();

  const where: string[] = [];
  let sql = "";

  // From old, deprecated query builder UI
  if (queryFormat === "builder" && !isFact && metric.conditions?.length) {
    metric.conditions.forEach((c) => {
      where.push(`m.${c.column} ${c.operator} '${c.value}'`);
    });
  }

  // Add filters from the Metric
  if (isFact && factTable && columnRef) {
    const sliceInfo = parseSliceMetricId(metric.id);
    getColumnRefWhereClause({
      factTable,
      columnRef,
      escapeStringLiteral: dialect.escapeStringLiteral.bind(dialect),
      jsonExtract: dialect.extractJSONField.bind(dialect),
      evalBoolean: dialect.evalBoolean.bind(dialect),
      sliceInfo,
    }).forEach((filterSQL) => {
      where.push(filterSQL);
    });

    sql = factTable.sql;
  }

  if (!isFact && queryFormat === "sql") {
    sql = metric.sql || "";
  }

  // Add date filter
  if (startDate) {
    where.push(`${cols.timestamp} >= ${dialect.toTimestamp(startDate)}`);
  }
  if (endDate) {
    where.push(`${cols.timestamp} <= ${dialect.toTimestamp(endDate)}`);
  }

  return compileSqlTemplate(
    `-- Metric (${metric.name})
      SELECT
        ${userIdCol} as ${baseIdType},
        ${cols.value} as value,
        ${timestampDateTimeColumn} as timestamp
      FROM
        ${
          queryFormat === "sql" || queryFormat === "fact"
            ? `(
              ${sql}
            )`
            : !isFact
              ? (schema && !metric.table?.match(/\./) ? schema + "." : "") +
                (metric.table || "")
              : ""
        } m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    {
      startDate,
      endDate: endDate || undefined,
      experimentId,
      phase,
      customFields,
      templateVariables: getMetricTemplateVariables(
        metric,
        factTableMap,
        useDenominator
      ),
    }
  );
}

/**
 * Build a fact metric CTE for calculating fact-based metric values.
 *
 * This function generates SQL for querying fact table data with:
 * - Multiple metrics from the same fact table
 * - Per-metric filters as CASE WHEN expressions
 * - Identity joins when needed
 * - Date filtering with inclusive/exclusive options
 *
 * @param dialect - SQL dialect implementation
 * @param params - Parameters including metrics, fact table, and dates
 * @returns SQL string for the fact metric CTE body
 */
export function buildFactMetricCTE(
  dialect: MetricCTEDialect,
  params: FactMetricCTEParams
): string {
  const {
    metricsWithIndices,
    factTable,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    addFiltersToWhere,
    phase,
    customFields,
    exclusiveStartDateFilter,
    exclusiveEndDateFilter,
    castIdToString,
  } = params;

  // Determine if a join is required to match up id types
  let join = "";
  let userIdCol = "";
  const userIdTypes = factTable.userIdTypes;

  if (userIdTypes.includes(baseIdType)) {
    userIdCol = baseIdType;
  } else if (userIdTypes.length > 0) {
    for (let i = 0; i < userIdTypes.length; i++) {
      const userIdType: string = userIdTypes[i];
      if (userIdType in idJoinMap) {
        const metricUserIdCol = `m.${userIdType}`;
        join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
        userIdCol = `i.${baseIdType}`;
        break;
      }
    }
  }

  // BQ datetime cast for SELECT statements (do not use for where)
  const timestampDateTimeColumn = dialect.castUserDateCol("m.timestamp");

  const sql = factTable.sql;
  const where: string[] = [];

  if (startDate) {
    const operator = exclusiveStartDateFilter ? ">" : ">=";
    const timestampFn = exclusiveStartDateFilter
      ? dialect.toTimestampWithMs
      : dialect.toTimestamp;
    where.push(`m.timestamp ${operator} ${timestampFn(startDate)}`);
  }
  if (endDate) {
    const operator = exclusiveEndDateFilter ? "<" : "<=";
    const timestampFn = exclusiveEndDateFilter
      ? dialect.toTimestampWithMs
      : dialect.toTimestamp;
    where.push(`m.timestamp ${operator} ${timestampFn(endDate)}`);
  }

  const metricCols: string[] = [];
  const filterWhere: Set<string> = new Set();

  let numberOfNumeratorsOrDenominatorsWithoutFilters = 0;

  metricsWithIndices.forEach((metricWithIndex) => {
    const m = metricWithIndex.metric;
    const index = metricWithIndex.index;

    // Get numerator if it matches the fact table
    if (m.numerator?.factTableId === factTable.id) {
      const value = dialect.getFactMetricColumn(
        m,
        m.numerator,
        factTable,
        "m"
      ).value;

      const sliceInfo = parseSliceMetricId(m.id, {
        [factTable.id]: factTable,
      });
      const filters = getColumnRefWhereClause({
        factTable,
        columnRef: m.numerator,
        escapeStringLiteral: dialect.escapeStringLiteral.bind(dialect),
        jsonExtract: dialect.extractJSONField.bind(dialect),
        evalBoolean: dialect.evalBoolean.bind(dialect),
        sliceInfo,
      });

      const column =
        filters.length > 0
          ? `CASE WHEN (${filters.join("\n AND ")}) THEN ${value} ELSE NULL END`
          : value;

      metricCols.push(`-- ${m.name}
        ${column} as m${index}_value`);

      if (!filters.length) {
        numberOfNumeratorsOrDenominatorsWithoutFilters++;
      }
      if (addFiltersToWhere && filters.length) {
        filterWhere.add(`(${filters.join("\n AND ")})`);
      }
    }

    // Add denominator column if there is one
    if (isRatioMetric(m) && m.denominator) {
      if (m.denominator.factTableId !== factTable.id) {
        return;
      }

      const value = dialect.getFactMetricColumn(
        m,
        m.denominator,
        factTable,
        "m"
      ).value;

      const sliceInfo = parseSliceMetricId(m.id, {
        [factTable.id]: factTable,
      });
      const filters = getColumnRefWhereClause({
        factTable,
        columnRef: m.denominator,
        escapeStringLiteral: dialect.escapeStringLiteral.bind(dialect),
        jsonExtract: dialect.extractJSONField.bind(dialect),
        evalBoolean: dialect.evalBoolean.bind(dialect),
        sliceInfo,
      });

      const column =
        filters.length > 0
          ? `CASE WHEN (${filters.join(" AND ")}) THEN ${value} ELSE NULL END`
          : value;

      metricCols.push(`-- ${m.name} (denominator)
        ${column} as m${index}_denominator`);

      if (!filters.length) {
        numberOfNumeratorsOrDenominatorsWithoutFilters++;
      }
      if (addFiltersToWhere && filters.length) {
        filterWhere.add(`(${filters.join("\n AND ")})`);
      }
    }
  });

  // Only add filter WHERE clause if all metrics have filters
  if (
    addFiltersToWhere &&
    filterWhere.size > 0 &&
    numberOfNumeratorsOrDenominatorsWithoutFilters === 0
  ) {
    where.push(`(${Array.from(filterWhere).join("\n OR ")})`);
  }

  return compileSqlTemplate(
    `-- Fact Table (${factTable.name})
      SELECT
        ${castIdToString ? `CAST(${userIdCol} AS STRING)` : userIdCol} as ${baseIdType},
        ${timestampDateTimeColumn} as timestamp,
        ${metricCols.join(",\n")}
      FROM(
          ${sql}
        ) m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    {
      startDate,
      endDate: endDate || undefined,
      experimentId,
      phase,
      customFields,
    }
  );
}
