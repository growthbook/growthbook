/**
 * Segment CTE Builder
 *
 * Pure functions for generating segment SQL CTEs.
 * Extracted from SqlIntegration.ts for better testability and reuse.
 *
 * Segments are used to filter experiment analysis to specific groups of users
 * (e.g., "premium users", "users from US"). They can be defined via SQL queries
 * or based on fact tables with filters.
 */

import { SegmentInterface } from "shared/types/segment";
import { FactTableInterface } from "shared/types/fact-table";
import { SQLVars } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";

/**
 * Interface for SQL generation methods needed by segment CTE builder.
 * This allows the function to be pure while still using dialect-specific SQL.
 */
export interface SegmentCTEDialect {
  /**
   * Cast a user-provided date column to the appropriate datetime type.
   * @param column - The column expression to cast
   * @returns SQL expression with appropriate date casting
   */
  castUserDateCol(column: string): string;
}

/**
 * Interface for fact segment CTE generation.
 * Used when a segment is based on a fact table rather than raw SQL.
 */
export interface FactSegmentCTEDialect extends SegmentCTEDialect {
  /**
   * Generate a fact segment CTE.
   * @param params - Parameters for fact segment generation
   * @returns SQL CTE string for the fact segment
   */
  getFactSegmentCTE(params: {
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    filters?: string[];
    sqlVars?: SQLVars;
  }): string;
}

/**
 * Parameters for building a segment CTE.
 */
export interface SegmentCTEParams {
  /** The segment to build a CTE for */
  segment: SegmentInterface;

  /** The base user ID type for the query */
  baseIdType: string;

  /** Map from user ID types to their identity join table names */
  idJoinMap: Record<string, string>;

  /** Map of fact tables by ID */
  factTableMap: FactTableMap;

  /** Optional SQL variables for template substitution */
  sqlVars?: SQLVars;
}

/**
 * Build a segment CTE for filtering users.
 *
 * Segments can be:
 * 1. SQL-based: User provides a SQL query returning (user_id, date)
 * 2. Fact-based: Segment is defined by filters on a fact table
 *
 * The function handles:
 * - Template variable substitution
 * - Date column casting (for dialect compatibility)
 * - Identity joins when segment uses different user ID type than base
 *
 * @param dialect - SQL dialect implementation with date casting
 * @param params - Parameters including segment, ID types, and fact tables
 * @returns SQL string for the segment CTE body (without the CTE name)
 *
 * @example
 * const segmentSql = buildSegmentCTE(dialect, {
 *   segment: premiumUsersSegment,
 *   baseIdType: "user_id",
 *   idJoinMap: {},
 *   factTableMap: new Map(),
 * });
 * // Returns: "-- Segment (Premium Users)\nSELECT user_id, date FROM (...) s"
 */
export function buildSegmentCTE(
  dialect: SegmentCTEDialect | FactSegmentCTEDialect,
  params: SegmentCTEParams
): string {
  const { segment, baseIdType, idJoinMap, factTableMap, sqlVars } = params;

  let segmentSql = "";

  // Handle SQL-based segments
  if (segment.type === "SQL") {
    if (!segment.sql) {
      throw new Error(
        `Segment ${segment.name} is a SQL Segment but has no SQL value`
      );
    }
    segmentSql = sqlVars
      ? compileSqlTemplate(segment.sql, sqlVars)
      : segment.sql;
  } else {
    // Handle fact-based segments
    if (!segment.factTableId) {
      throw new Error(
        `Segment ${segment.name} is a FACT Segment, but has no factTableId set`
      );
    }
    const factTable = factTableMap.get(segment.factTableId);

    if (!factTable) {
      throw new Error(`Unknown fact table: ${segment.factTableId}`);
    }

    // Type guard to check if dialect supports fact segments
    if (!("getFactSegmentCTE" in dialect)) {
      throw new Error(
        "Dialect does not support fact-based segments. Use a dialect that implements FactSegmentCTEDialect."
      );
    }

    const factDialect = dialect as FactSegmentCTEDialect;
    segmentSql = factDialect.getFactSegmentCTE({
      baseIdType,
      idJoinMap,
      factTable,
      filters: segment.filters,
      sqlVars,
    });

    return `-- Segment (${segment.name})
        SELECT * FROM (\n${segmentSql}\n) s `;
  }

  // Handle date column casting
  const dateCol = dialect.castUserDateCol("s.date");
  const userIdType = segment.userIdType || "user_id";

  // Need to use an identity join table when segment uses different ID type
  if (userIdType !== baseIdType) {
    return `-- Segment (${segment.name})
      SELECT
        i.${baseIdType},
        ${dateCol} as date
      FROM
        (
          ${segmentSql}
        ) s
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = s.${userIdType} )
      `;
  }

  // If date column needs casting, wrap the SQL
  if (dateCol !== "s.date") {
    return `-- Segment (${segment.name})
      SELECT
        s.${userIdType},
        ${dateCol} as date
      FROM
        (
          ${segmentSql}
        ) s`;
  }

  // Simple case: no casting or joins needed
  return `-- Segment (${segment.name})
    ${segmentSql}
    `;
}

/**
 * Build a fact segment CTE for filtering users based on a fact table.
 *
 * This is the core logic extracted from SqlIntegration.getFactSegmentCTE.
 * It generates SQL to select users from a fact table, optionally applying
 * filters and joining to identity tables when needed.
 *
 * @param dialect - SQL dialect implementation with date casting
 * @param params - Parameters for fact segment generation
 * @returns SQL string for the fact segment
 */
export function buildFactSegmentCTE(
  dialect: SegmentCTEDialect,
  params: {
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    filters?: string[];
    sqlVars?: SQLVars;
  }
): string {
  const { factTable, baseIdType, idJoinMap, filters, sqlVars } = params;

  // Determine if a join is required to match up ID types
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

  // BQ datetime cast for SELECT statements (do not use for WHERE)
  const timestampDateTimeColumn = dialect.castUserDateCol("m.timestamp");

  const sql = factTable.sql;

  const where: string[] = [];

  // Apply filters from the segment
  if (filters?.length) {
    filters.forEach((filter) => {
      const filterObj = factTable.filters.find(
        (factFilter) => factFilter.id === filter
      );

      if (filterObj) {
        where.push(filterObj.value);
      }
    });
  }

  const baseSql = `-- Fact Table (${factTable.name})
    SELECT
      ${userIdCol} as ${baseIdType},
      ${timestampDateTimeColumn} as date
    FROM(
        ${sql}
      ) m
      ${join}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;

  return sqlVars ? compileSqlTemplate(baseSql, sqlVars) : baseSql;
}
