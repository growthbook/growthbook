/**
 * SQL Keywords and Functions for Autocompletion
 *
 * This file contains a comprehensive list of SQL keywords and functions organized
 * by category and with support for different SQL dialects.
 *
 * ## Adding New Keywords
 *
 * To add a new keyword:
 * 1. Add it to the SQL_KEYWORD_DEFINITIONS array
 * 2. Specify the appropriate meta type (KEYWORD or FUNCTION)
 * 3. Set an appropriate score (higher = more important), using the COMPLETION_SCORES object.
 *
 * ## Future Enhancements
 *
 * - Add more dialect-specific functions
 * - Include function signatures and descriptions
 *
 *
 * Examples:
 * - ILIKE is only available in PostgreSQL, Redshift, and Snowflake
 * - Window functions are not available in SQLite
 * - CTEs (WITH) are not available in older MySQL versions
 *
 */

import { AceCompletion } from "@/components/Forms/CodeTextArea";

// Constants for completion scores - single source of truth for all SQL completions
export const COMPLETION_SCORES = {
  DATABASE: 1000,
  SCHEMA: 950,
  TABLE: 900,
  COLUMN: 900,
  TEMPLATE_VARIABLE: 800,
  CORE_KEYWORD: 500,
  JOIN_KEYWORD: 450,
  SUBQUERY_KEYWORD: 450,
  IMPORTANT_KEYWORD: 400,
  AGGREGATE_FUNCTION: 350,
  CASE_STATEMENT: 350,
  SORTING_KEYWORD: 350,
  FUNCTION: 300,
  WINDOW_FUNCTION: 250,
  LESS_COMMON_KEYWORD: 200,
} as const;

// Constants for completion types
export const COMPLETION_TYPES = {
  TEMPLATE_VARIABLE: "TEMPLATE VARIABLE",
  DATABASE: "DATABASE",
  SCHEMA: "SCHEMA",
  TABLE: "TABLE",
  KEYWORD: "KEYWORD",
  FUNCTION: "FUNCTION",
} as const;

export interface SqlKeywordDefinition {
  value: string;
  meta: "KEYWORD" | "FUNCTION";
  score: number;
  caption: string;
  //FUTURE: Add support for array. E.G.  dialects?: SqlDialect[]; so we can filter certain keywords by dialect. If undefined, available in all dialects
}

export const templateCompletions: AceCompletion[] = [
  {
    value: `'{{ startDate }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ startDate }}`,
  },
  {
    value: `'{{ startDateISO }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ startDateISO }}`,
  },
  {
    value: `'{{ endDate }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ endDate }}`,
  },
  {
    value: `'{{ endDateISO }}'`,
    meta: COMPLETION_TYPES.TEMPLATE_VARIABLE,
    score: COMPLETION_SCORES.TEMPLATE_VARIABLE,
    caption: `{{ endDateISO }}`,
  },
];

// Currently, template variables are only available in the EditSqlModal
// In the future, we'll add template variable support to the SqlExplorer
// including the ability to reference fact tables as template variables (e.g. {{ ftb_xxx }})
export function getTemplateCompletions(
  source: "EditSqlModal" | "SqlExplorer",
): AceCompletion[] {
  if (source === "EditSqlModal") {
    return templateCompletions;
  }
  return [];
}

/**
 * Comprehensive SQL Keywords organized by category
 
 */
export const SQL_KEYWORD_DEFINITIONS: SqlKeywordDefinition[] = [
  // Core SQL keywords (ANSI SQL standard - available in all dialects)
  {
    value: "SELECT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "SELECT",
  },
  {
    value: "FROM",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "FROM",
  },
  {
    value: "WHERE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "WHERE",
  },
  {
    value: "GROUP BY",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "GROUP BY",
  },
  {
    value: "ORDER BY",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "ORDER BY",
  },
  {
    value: "HAVING",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CORE_KEYWORD,
    caption: "HAVING",
  },
  {
    value: "LIMIT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "LIMIT",
  },
  {
    value: "OFFSET",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "OFFSET",
  },

  // JOIN keywords (ANSI SQL standard)
  {
    value: "JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "JOIN",
  },
  {
    value: "INNER JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "INNER JOIN",
  },
  {
    value: "LEFT JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "LEFT JOIN",
  },
  {
    value: "RIGHT JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "RIGHT JOIN",
  },
  {
    value: "FULL JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "FULL JOIN",
  },
  {
    value: "FULL OUTER JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "FULL OUTER JOIN",
  },
  {
    value: "CROSS JOIN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "CROSS JOIN",
  },
  {
    value: "ON",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "ON",
  },
  {
    value: "USING",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.JOIN_KEYWORD,
    caption: "USING",
  },

  // Logical operators (ANSI SQL standard)
  {
    value: "AND",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "AND",
  },
  {
    value: "OR",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "OR",
  },
  {
    value: "NOT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "NOT",
  },
  {
    value: "IN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "IN",
  },
  {
    value: "EXISTS",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "EXISTS",
  },
  {
    value: "BETWEEN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "BETWEEN",
  },
  {
    value: "LIKE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "LIKE",
  },
  {
    value: "ILIKE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "ILIKE",
  },
  {
    value: "IS NULL",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "IS NULL",
  },
  {
    value: "IS NOT NULL",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "IS NOT NULL",
  },

  // Aggregate functions (ANSI SQL standard)
  {
    value: "COUNT",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "COUNT",
  },
  {
    value: "SUM",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "SUM",
  },
  {
    value: "AVG",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "AVG",
  },
  {
    value: "MIN",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "MIN",
  },
  {
    value: "MAX",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "MAX",
  },
  {
    value: "COUNT(DISTINCT",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.AGGREGATE_FUNCTION,
    caption: "COUNT(DISTINCT",
  },

  // String functions (mostly standard, some dialect-specific)
  {
    value: "CONCAT",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "CONCAT",
  },
  {
    value: "SUBSTRING",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "SUBSTRING",
  },
  {
    value: "LENGTH",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "LENGTH",
  },
  {
    value: "UPPER",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "UPPER",
  },
  {
    value: "LOWER",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "LOWER",
  },
  {
    value: "TRIM",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "TRIM",
  },
  {
    value: "REPLACE",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "REPLACE",
  },

  // Date functions (some dialect-specific variations)
  {
    value: "NOW()",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "NOW()",
  },
  {
    value: "CURRENT_DATE",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "CURRENT_DATE",
  },
  {
    value: "CURRENT_TIMESTAMP",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "CURRENT_TIMESTAMP",
  },
  {
    value: "DATE_TRUNC",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "DATE_TRUNC",
  },
  {
    value: "EXTRACT",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "EXTRACT",
  },
  {
    value: "DATE_ADD",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "DATE_ADD",
  },
  {
    value: "DATE_SUB",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "DATE_SUB",
  },
  {
    value: "DATEDIFF",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "DATEDIFF",
  },

  // Window functions (SQL:2003 standard, but not supported in all dialects)
  {
    value: "ROW_NUMBER()",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "ROW_NUMBER()",
  },
  {
    value: "RANK()",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "RANK()",
  },
  {
    value: "DENSE_RANK()",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "DENSE_RANK()",
  },
  {
    value: "LAG",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "LAG",
  },
  {
    value: "LEAD",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "LEAD",
  },
  {
    value: "FIRST_VALUE",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "FIRST_VALUE",
  },
  {
    value: "LAST_VALUE",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "LAST_VALUE",
  },
  {
    value: "OVER",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "OVER",
  },
  {
    value: "PARTITION BY",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.WINDOW_FUNCTION,
    caption: "PARTITION BY",
  },

  // CASE statements (ANSI SQL standard)
  {
    value: "CASE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CASE_STATEMENT,
    caption: "CASE",
  },
  {
    value: "WHEN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CASE_STATEMENT,
    caption: "WHEN",
  },
  {
    value: "THEN",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CASE_STATEMENT,
    caption: "THEN",
  },
  {
    value: "ELSE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CASE_STATEMENT,
    caption: "ELSE",
  },
  {
    value: "END",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.CASE_STATEMENT,
    caption: "END",
  },

  // Subquery keywords (ANSI SQL standard)
  {
    value: "WITH",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.SUBQUERY_KEYWORD,
    caption: "WITH",
  },
  {
    value: "AS",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "AS",
  },
  {
    value: "UNION",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "UNION",
  },
  {
    value: "UNION ALL",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "UNION ALL",
  },
  {
    value: "INTERSECT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "INTERSECT",
  },
  {
    value: "EXCEPT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "EXCEPT",
  },

  // Data type functions (ANSI SQL standard)
  {
    value: "CAST",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "CAST",
  },
  {
    value: "CONVERT",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "CONVERT",
  },
  {
    value: "COALESCE",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "COALESCE",
  },
  {
    value: "NULLIF",
    meta: "FUNCTION",
    score: COMPLETION_SCORES.FUNCTION,
    caption: "NULLIF",
  },

  // Sorting (ANSI SQL standard)
  {
    value: "ASC",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.SORTING_KEYWORD,
    caption: "ASC",
  },
  {
    value: "DESC",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.SORTING_KEYWORD,
    caption: "DESC",
  },

  // Other common keywords (ANSI SQL standard)
  {
    value: "DISTINCT",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.IMPORTANT_KEYWORD,
    caption: "DISTINCT",
  },
  {
    value: "ALL",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "ALL",
  },
  {
    value: "ANY",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "ANY",
  },
  {
    value: "SOME",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "SOME",
  },
  {
    value: "TRUE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "TRUE",
  },
  {
    value: "FALSE",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "FALSE",
  },
  {
    value: "NULL",
    meta: "KEYWORD",
    score: COMPLETION_SCORES.LESS_COMMON_KEYWORD,
    caption: "NULL",
  },
];

export function getSqlKeywords(): AceCompletion[] {
  return SQL_KEYWORD_DEFINITIONS;
}
