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
 * 3. Set an appropriate score (higher = more important)
 *
 * ## Future Enhancements
 *
 * - Add more dialect-specific functions
 * - Include function signatures and descriptions
 * - Add context-aware keyword suggestions
 * - Support for database-specific extensions
 *
 *
 * Examples:
 * - ILIKE is only available in PostgreSQL, Redshift, and Snowflake
 * - Window functions are not available in SQLite
 * - CTEs (WITH) are not available in older MySQL versions
 *
 */

import { AceCompletion } from "@/components/Forms/CodeTextArea";

export interface SqlKeywordDefinition {
  value: string;
  meta: "KEYWORD" | "FUNCTION";
  score: number;
  caption: string;
  //FUTURE: Add support for array. E.G.  dialects?: SqlDialect[]; so we can filter certain keywords by dialect. If undefined, available in all dialects
}

/**
 * Comprehensive SQL Keywords organized by category
 *
 * Score ranges:
 * - Template variables: 1100
 * - Databases: 1000
 * - Schemas: 950
 * - Tables/Columns: 900
 * - Core SQL keywords: 500
 * - Important keywords: 400
 * - Functions: 300
 * - Less common keywords: 200
 */
export const SQL_KEYWORD_DEFINITIONS: SqlKeywordDefinition[] = [
  // Core SQL keywords (ANSI SQL standard - available in all dialects)
  { value: "SELECT", meta: "KEYWORD", score: 500, caption: "SELECT" },
  { value: "FROM", meta: "KEYWORD", score: 500, caption: "FROM" },
  { value: "WHERE", meta: "KEYWORD", score: 500, caption: "WHERE" },
  { value: "GROUP BY", meta: "KEYWORD", score: 500, caption: "GROUP BY" },
  { value: "ORDER BY", meta: "KEYWORD", score: 500, caption: "ORDER BY" },
  { value: "HAVING", meta: "KEYWORD", score: 500, caption: "HAVING" },
  { value: "LIMIT", meta: "KEYWORD", score: 400, caption: "LIMIT" },
  { value: "OFFSET", meta: "KEYWORD", score: 400, caption: "OFFSET" },

  // JOIN keywords (ANSI SQL standard)
  { value: "JOIN", meta: "KEYWORD", score: 450, caption: "JOIN" },
  { value: "INNER JOIN", meta: "KEYWORD", score: 450, caption: "INNER JOIN" },
  { value: "LEFT JOIN", meta: "KEYWORD", score: 450, caption: "LEFT JOIN" },
  { value: "RIGHT JOIN", meta: "KEYWORD", score: 450, caption: "RIGHT JOIN" },
  { value: "FULL JOIN", meta: "KEYWORD", score: 450, caption: "FULL JOIN" },
  {
    value: "FULL OUTER JOIN",
    meta: "KEYWORD",
    score: 450,
    caption: "FULL OUTER JOIN",
  },
  { value: "CROSS JOIN", meta: "KEYWORD", score: 450, caption: "CROSS JOIN" },
  { value: "ON", meta: "KEYWORD", score: 450, caption: "ON" },
  { value: "USING", meta: "KEYWORD", score: 450, caption: "USING" },

  // Logical operators (ANSI SQL standard)
  { value: "AND", meta: "KEYWORD", score: 400, caption: "AND" },
  { value: "OR", meta: "KEYWORD", score: 400, caption: "OR" },
  { value: "NOT", meta: "KEYWORD", score: 400, caption: "NOT" },
  { value: "IN", meta: "KEYWORD", score: 400, caption: "IN" },
  { value: "EXISTS", meta: "KEYWORD", score: 400, caption: "EXISTS" },
  { value: "BETWEEN", meta: "KEYWORD", score: 400, caption: "BETWEEN" },
  { value: "LIKE", meta: "KEYWORD", score: 400, caption: "LIKE" },
  {
    value: "ILIKE",
    meta: "KEYWORD",
    score: 400,
    caption: "ILIKE",
  },
  { value: "IS NULL", meta: "KEYWORD", score: 400, caption: "IS NULL" },
  { value: "IS NOT NULL", meta: "KEYWORD", score: 400, caption: "IS NOT NULL" },

  // Aggregate functions (ANSI SQL standard)
  { value: "COUNT", meta: "FUNCTION", score: 350, caption: "COUNT" },
  { value: "SUM", meta: "FUNCTION", score: 350, caption: "SUM" },
  { value: "AVG", meta: "FUNCTION", score: 350, caption: "AVG" },
  { value: "MIN", meta: "FUNCTION", score: 350, caption: "MIN" },
  { value: "MAX", meta: "FUNCTION", score: 350, caption: "MAX" },
  {
    value: "COUNT(DISTINCT",
    meta: "FUNCTION",
    score: 350,
    caption: "COUNT(DISTINCT",
  },

  // String functions (mostly standard, some dialect-specific)
  { value: "CONCAT", meta: "FUNCTION", score: 300, caption: "CONCAT" },
  { value: "SUBSTRING", meta: "FUNCTION", score: 300, caption: "SUBSTRING" },
  { value: "LENGTH", meta: "FUNCTION", score: 300, caption: "LENGTH" },
  { value: "UPPER", meta: "FUNCTION", score: 300, caption: "UPPER" },
  { value: "LOWER", meta: "FUNCTION", score: 300, caption: "LOWER" },
  { value: "TRIM", meta: "FUNCTION", score: 300, caption: "TRIM" },
  { value: "REPLACE", meta: "FUNCTION", score: 300, caption: "REPLACE" },

  // Date functions (some dialect-specific variations)
  {
    value: "NOW()",
    meta: "FUNCTION",
    score: 300,
    caption: "NOW()",
  },
  {
    value: "CURRENT_DATE",
    meta: "FUNCTION",
    score: 300,
    caption: "CURRENT_DATE",
  },
  {
    value: "CURRENT_TIMESTAMP",
    meta: "FUNCTION",
    score: 300,
    caption: "CURRENT_TIMESTAMP",
  },
  {
    value: "DATE_TRUNC",
    meta: "FUNCTION",
    score: 300,
    caption: "DATE_TRUNC",
  },
  { value: "EXTRACT", meta: "FUNCTION", score: 300, caption: "EXTRACT" },
  {
    value: "DATE_ADD",
    meta: "FUNCTION",
    score: 300,
    caption: "DATE_ADD",
  },
  {
    value: "DATE_SUB",
    meta: "FUNCTION",
    score: 300,
    caption: "DATE_SUB",
  },
  {
    value: "DATEDIFF",
    meta: "FUNCTION",
    score: 300,
    caption: "DATEDIFF",
  },

  // Window functions (SQL:2003 standard, but not supported in all dialects)
  {
    value: "ROW_NUMBER()",
    meta: "FUNCTION",
    score: 250,
    caption: "ROW_NUMBER()",
  },
  {
    value: "RANK()",
    meta: "FUNCTION",
    score: 250,
    caption: "RANK()",
  },
  {
    value: "DENSE_RANK()",
    meta: "FUNCTION",
    score: 250,
    caption: "DENSE_RANK()",
  },
  {
    value: "LAG",
    meta: "FUNCTION",
    score: 250,
    caption: "LAG",
  },
  {
    value: "LEAD",
    meta: "FUNCTION",
    score: 250,
    caption: "LEAD",
  },
  {
    value: "FIRST_VALUE",
    meta: "FUNCTION",
    score: 250,
    caption: "FIRST_VALUE",
  },
  {
    value: "LAST_VALUE",
    meta: "FUNCTION",
    score: 250,
    caption: "LAST_VALUE",
  },
  {
    value: "OVER",
    meta: "KEYWORD",
    score: 250,
    caption: "OVER",
  },
  {
    value: "PARTITION BY",
    meta: "KEYWORD",
    score: 250,
    caption: "PARTITION BY",
  },

  // CASE statements (ANSI SQL standard)
  { value: "CASE", meta: "KEYWORD", score: 350, caption: "CASE" },
  { value: "WHEN", meta: "KEYWORD", score: 350, caption: "WHEN" },
  { value: "THEN", meta: "KEYWORD", score: 350, caption: "THEN" },
  { value: "ELSE", meta: "KEYWORD", score: 350, caption: "ELSE" },
  { value: "END", meta: "KEYWORD", score: 350, caption: "END" },

  // Subquery keywords (ANSI SQL standard)
  {
    value: "WITH",
    meta: "KEYWORD",
    score: 450,
    caption: "WITH",
  },
  { value: "AS", meta: "KEYWORD", score: 400, caption: "AS" },
  { value: "UNION", meta: "KEYWORD", score: 400, caption: "UNION" },
  { value: "UNION ALL", meta: "KEYWORD", score: 400, caption: "UNION ALL" },
  { value: "INTERSECT", meta: "KEYWORD", score: 400, caption: "INTERSECT" },
  { value: "EXCEPT", meta: "KEYWORD", score: 400, caption: "EXCEPT" },

  // Data type functions (ANSI SQL standard)
  { value: "CAST", meta: "FUNCTION", score: 300, caption: "CAST" },
  {
    value: "CONVERT",
    meta: "FUNCTION",
    score: 300,
    caption: "CONVERT",
  },
  { value: "COALESCE", meta: "FUNCTION", score: 300, caption: "COALESCE" },
  { value: "NULLIF", meta: "FUNCTION", score: 300, caption: "NULLIF" },

  // Sorting (ANSI SQL standard)
  { value: "ASC", meta: "KEYWORD", score: 350, caption: "ASC" },
  { value: "DESC", meta: "KEYWORD", score: 350, caption: "DESC" },

  // Other common keywords (ANSI SQL standard)
  { value: "DISTINCT", meta: "KEYWORD", score: 400, caption: "DISTINCT" },
  { value: "ALL", meta: "KEYWORD", score: 200, caption: "ALL" },
  { value: "ANY", meta: "KEYWORD", score: 200, caption: "ANY" },
  { value: "SOME", meta: "KEYWORD", score: 200, caption: "SOME" },
  { value: "TRUE", meta: "KEYWORD", score: 200, caption: "TRUE" },
  { value: "FALSE", meta: "KEYWORD", score: 200, caption: "FALSE" },
  { value: "NULL", meta: "KEYWORD", score: 200, caption: "NULL" },
];

export function getSqlKeywords(): AceCompletion[] {
  return SQL_KEYWORD_DEFINITIONS.map((def) => ({
    value: def.value,
    meta: def.meta,
    score: def.score,
    caption: def.caption,
  }));
}
