/**
 * Schema Discovery Query Generator
 *
 * Generates SQL queries to discover database schema information from
 * the information_schema or equivalent system tables.
 *
 * Note: Schema discovery is highly database-specific. Different databases
 * have different metadata tables and structures. This module provides
 * common patterns that work with most SQL databases.
 */

import { format, FormatDialect } from "sql-formatter";

/**
 * Configuration for information schema table discovery
 */
export interface InformationSchemaConfig {
  /** The table path to query (e.g., "information_schema.columns") */
  tablePath: string;
  /** WHERE clause to filter schemas (e.g., "table_schema NOT IN ('information_schema')") */
  whereClause: string;
  /** The format dialect for sql-formatter */
  formatDialect: FormatDialect;
  /** Override table_catalog with a fixed value (for databases like Vertica) */
  fixedCatalog?: string;
}

/**
 * Parameters for generating table data query
 */
export interface TableDataQueryParams {
  /** The database/catalog name */
  databaseName: string;
  /** The schema name */
  tableSchema: string;
  /** The table name to get column info for */
  tableName: string;
}

/**
 * Generate SQL query to list all tables in the information schema.
 *
 * Returns columns:
 * - table_name: Name of the table
 * - table_catalog: Database/catalog name
 * - table_schema: Schema name
 * - column_count: Number of columns in the table
 *
 * @param config Information schema configuration
 * @returns Formatted SQL query string
 */
export function generateInformationSchemaQuery(
  config: InformationSchemaConfig
): string {
  const { tablePath, whereClause, formatDialect, fixedCatalog } = config;

  const catalogColumn = fixedCatalog
    ? `'${fixedCatalog}' as table_catalog`
    : "table_catalog as table_catalog";

  const groupByColumns = fixedCatalog
    ? `table_name, table_schema, '${fixedCatalog}'`
    : "table_name, table_schema, table_catalog";

  const sql = `
SELECT
  table_name as table_name,
  ${catalogColumn},
  table_schema as table_schema,
  count(column_name) as column_count
FROM
  ${tablePath}
WHERE ${whereClause}
GROUP BY ${groupByColumns}`;

  return format(sql, formatDialect);
}

/**
 * Generate SQL query to get column information for a specific table.
 *
 * Returns columns:
 * - data_type: The column data type
 * - column_name: Name of the column
 *
 * @param config Information schema configuration
 * @param params Query parameters with table identifiers
 * @returns Formatted SQL query string
 */
export function generateTableDataQuery(
  config: InformationSchemaConfig,
  params: TableDataQueryParams
): string {
  const { tablePath, formatDialect } = config;
  const { databaseName, tableSchema, tableName } = params;

  // Basic SQL injection prevention for table/schema/database names
  const safeDatabaseName = databaseName.replace(/'/g, "''");
  const safeTableSchema = tableSchema.replace(/'/g, "''");
  const safeTableName = tableName.replace(/'/g, "''");

  const sql = `
SELECT
  data_type as data_type,
  column_name as column_name
FROM
  ${tablePath}
WHERE
  table_name = '${safeTableName}'
  AND table_schema = '${safeTableSchema}'
  AND table_catalog = '${safeDatabaseName}'`;

  return format(sql, formatDialect);
}

/**
 * Default information schema configurations for common databases.
 * These can be used as starting points or directly for databases
 * that follow standard patterns.
 */
export const defaultInformationSchemaConfigs = {
  /**
   * Standard SQL configuration - works for most databases
   */
  standard: {
    tablePath: "information_schema.columns",
    whereClause: "table_schema NOT IN ('information_schema')",
  },

  /**
   * BigQuery configuration
   * Note: BigQuery requires querying per-dataset, so the tablePath
   * should be constructed with the dataset name included.
   */
  bigquery: {
    tablePath: "INFORMATION_SCHEMA.COLUMNS", // Needs dataset prefix
    whereClause: "table_schema NOT IN ('information_schema')",
  },

  /**
   * Redshift configuration - uses SVV_COLUMNS view
   */
  redshift: {
    tablePath: "SVV_COLUMNS",
    whereClause: "table_schema NOT IN ('information_schema')",
  },

  /**
   * Vertica configuration - uses v_catalog.columns
   */
  vertica: {
    tablePath: "v_catalog.columns",
    whereClause:
      "table_schema NOT IN ('v_catalog', 'v_monitor', 'v_license') AND NOT is_system_table",
  },

  /**
   * MySQL configuration
   */
  mysql: {
    tablePath: "information_schema.columns",
    whereClause: "table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')",
  },

  /**
   * Postgres configuration
   */
  postgres: {
    tablePath: "information_schema.columns",
    whereClause: "table_schema NOT IN ('information_schema', 'pg_catalog')",
  },

  /**
   * Snowflake configuration
   */
  snowflake: {
    tablePath: "information_schema.columns",
    whereClause: "table_schema NOT IN ('INFORMATION_SCHEMA')",
  },

  /**
   * ClickHouse configuration
   */
  clickhouse: {
    tablePath: "system.columns",
    whereClause: "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')",
  },
} as const;

/**
 * Helper to generate table path with database and schema prefixes.
 *
 * This mimics the generateTablePath logic from SqlIntegration.ts
 * but as a pure function.
 *
 * @param tableName The table name (can include schema like "information_schema.columns")
 * @param schema Optional schema prefix
 * @param database Optional database prefix
 * @param escapeChar Optional character to escape the path (e.g., backticks)
 * @returns Fully qualified table path
 */
export function generateTablePath(
  tableName: string,
  options: {
    schema?: string;
    database?: string;
    escapeChar?: string;
    requiresDatabase?: boolean;
    requiresSchema?: boolean;
  } = {}
): string {
  const { schema, database, escapeChar, requiresDatabase, requiresSchema } =
    options;

  let path = "";

  // Add database if required
  if (requiresDatabase && database) {
    path += database + ".";
  }

  // Add schema if required
  if (requiresSchema && schema) {
    path += schema + ".";
  }

  // Add table name
  path += tableName;

  return escapeChar ? `${escapeChar}${path}${escapeChar}` : path;
}
