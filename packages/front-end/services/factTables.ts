import {
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import { DetectedFactTableColumn } from "shared/types/fact-table";
import { Column } from "shared/types/integrations";
import { SqlIdentifierQuote } from "shared/types/sql";
import { quoteIdentifier } from "shared/sql";
import { Permissions } from "shared/permissions";
import { mapDatabaseTypeToEnum } from "shared/enterprise";
import { SchemaBrowserTable } from "@/services/schemaBrowserTables";

/**
 * Projects a new Fact Table should be created in. Inherits the Data Source's
 * projects, minus any the user can't create Fact Tables in. A Data Source in
 * "all projects" stays global for users with global create permission, and
 * otherwise falls back to the project the user is currently viewing.
 */
export function getNewFactTableProjects({
  datasource,
  project,
  permissionsUtil,
}: {
  datasource: DataSourceInterfaceWithParams;
  project: string;
  permissionsUtil: Permissions;
}): string[] {
  const projects = datasource.projects || [];

  if (projects.length) {
    return projects.filter((p) =>
      permissionsUtil.canCreateFactTable({ projects: [p] }),
    );
  }

  return permissionsUtil.canCreateFactTable({ projects: [] })
    ? []
    : [project].filter(Boolean);
}

/**
 * Column mapping happens after the SQL step, but the candidates are already
 * known from the detected types, so a query that can never map is caught while
 * the SQL is still on screen. An undetected type ("") is unknown, not wrong,
 * so it stays a candidate for both.
 */
export const isTimestampCandidate = (c: DetectedFactTableColumn) =>
  ["date", "other", ""].includes(c.datatype);

export const isIdentifierCandidate = (c: DetectedFactTableColumn) =>
  ["string", "number", "other", ""].includes(c.datatype);

export function getColumnMappingError(
  columns: DetectedFactTableColumn[],
  fromTable = false,
): string | null {
  if (!columns.some(isTimestampCandidate)) {
    return fromTable
      ? "Selected table does not have a timestamp column."
      : "Your query must return a date column to use as the timestamp.";
  }
  if (!columns.some(isIdentifierCandidate)) {
    return fromTable
      ? "Selected table does not have an identifier column."
      : "Your query must return a string or number column to use as an identifier.";
  }
  // A single column can satisfy both checks when its type is unknown, but the
  // timestamp and the identifier have to be different columns.
  if (columns.length < 2) {
    return fromTable
      ? "Selected table must have separate timestamp and identifier columns."
      : "Your query must return separate timestamp and identifier columns.";
  }
  return null;
}

const tableSuffixFilter = (prefix: string) =>
  `(_TABLE_SUFFIX BETWEEN '${prefix}{{date startDateISO "yyyyMMdd"}}' AND '${prefix}{{date endDateISO "yyyyMMdd"}}')`;

const shardFilter = (hasIntraday?: boolean) =>
  hasIntraday
    ? `(${tableSuffixFilter("")} OR ${tableSuffixFilter("intraday_")})`
    : tableSuffixFilter("");

export function getGA4EventsSql(eventsTable: string): string {
  return `SELECT
  TIMESTAMP_MICROS(event_timestamp) as timestamp,
  user_id,
  user_pseudo_id as anonymous_id,
  event_name,
  geo.country,
  device.category as device_category,
  traffic_source.source,
  traffic_source.medium,
  traffic_source.name as campaign,
  REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'http[s]?:\\/\\/?[^\\/\\s]+\\/([^?]*)') as page_path,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') as session_engaged,
  event_value_in_usd,
  CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS string) as session_id,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec')/1000 as engagement_time
FROM
  ${eventsTable}
WHERE
  ${shardFilter(true)}`;
}

export const isGA4EventsTable = (table: SchemaBrowserTable) =>
  !!table.shards &&
  table.tableName === "events_*" &&
  table.schemaName.startsWith("analytics_");

const toDetectedColumns = (columns: Column[]) =>
  columns.map((c) => ({
    column: c.columnName,
    datatype: mapDatabaseTypeToEnum(c.dataType),
  }));

export function getPickerTableError(
  table: SchemaBrowserTable,
  columns: Column[],
): string | null {
  // GA4's query builds its own timestamp and identifier columns
  if (isGA4EventsTable(table)) return null;
  return getColumnMappingError(toDetectedColumns(columns), true);
}

// Null when every column is selected, or when the table itself is unusable,
// which getPickerTableError reports instead
export function getPickerSelectionError(
  table: SchemaBrowserTable,
  columns: Column[],
  selected: string[],
): string | null {
  if (!selected.length || getPickerTableError(table, columns)) return null;
  return getColumnMappingError(
    toDetectedColumns(columns).filter((c) => selected.includes(c.column)),
  )
    ? "Selected columns must include a timestamp column and a separate identifier column."
    : null;
}

// String partitions (Hive-style `dt`) can be any format; only dates are safe
export function getPartitionFilterColumn(columns: Column[]): string {
  return (
    columns.find(
      (c) => c.isPartition && mapDatabaseTypeToEnum(c.dataType) === "date",
    )?.columnName ?? ""
  );
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Pruning filters only, lower bound only: metric queries bound the timestamp
export function getPickerTableSql(
  table: SchemaBrowserTable,
  {
    partitionColumn = "",
    datasourceType,
    identifierQuote = '"',
    columns = [],
    rowFilterWhere = "",
  }: {
    partitionColumn?: string;
    datasourceType?: DataSourceType;
    identifierQuote?: SqlIdentifierQuote;
    // Empty selects every column
    columns?: string[];
    // Compiled row filters, already joined with AND
    rowFilterWhere?: string;
  } = {},
): string {
  // Hand-written, so it picks its own columns. Its WHERE reads the raw export
  // columns, which are the ones the filters offer.
  if (isGA4EventsTable(table)) {
    const sql = getGA4EventsSql(table.path);
    return rowFilterWhere ? `${sql}\n  AND ${rowFilterWhere}` : sql;
  }

  const quote = (c: string) =>
    SIMPLE_IDENTIFIER.test(c) ? c : quoteIdentifier(c, identifierQuote);

  const where = table.shards ? [shardFilter(table.hasIntraday)] : [];
  if (partitionColumn) {
    const start = `'{{date startDateISO "yyyy-MM-dd"}}'`;
    // Athena doesn't coerce a string literal when comparing it to a date
    const literal = datasourceType === "athena" ? `DATE ${start}` : start;
    where.push(`${quote(partitionColumn)} >= ${literal}`);
  }
  if (rowFilterWhere) where.push(rowFilterWhere);
  const select = columns.length
    ? `SELECT\n  ${columns.map(quote).join(",\n  ")}\nFROM ${table.path}`
    : `SELECT * FROM ${table.path}`;
  return where.length
    ? `${select}\nWHERE\n  ${where.join("\n  AND ")}`
    : select;
}

// Trackers' own timestamps win over their other date columns
const TIMESTAMP_CANDIDATES = [
  "received_at",
  "timestamp",
  "event_time",
  "collector_tstamp",
];

export function getDefaultTimestampColumn(
  columns: DetectedFactTableColumn[],
): string {
  const dates = columns.filter((c) => c.datatype === "date");
  const preferred = TIMESTAMP_CANDIDATES.map((name) =>
    dates.find((c) => c.column.toLowerCase() === name),
  ).find(Boolean);
  return (preferred ?? dates[0])?.column ?? "";
}

export function getPickerTableName(table: SchemaBrowserTable): string {
  return isGA4EventsTable(table)
    ? "GA4 Events"
    : table.tableName.replace(/_?\*$/, "");
}
