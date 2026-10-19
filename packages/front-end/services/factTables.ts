import {
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import { DetectedColumn, FactTableColumnType } from "shared/types/fact-table";
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
export const isTimestampCandidate = (c: DetectedColumn) =>
  ["date", "other", ""].includes(c.datatype);

export const isIdentifierCandidate = (c: DetectedColumn) =>
  ["string", "number", "other", ""].includes(c.datatype);

export function getColumnMappingError(
  columns: DetectedColumn[],
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

// Output of getGA4EventsSql, typed by the GA4 export schema
const GA4_EVENTS_COLUMNS: DetectedColumn[] = [
  { column: "timestamp", datatype: "date" },
  { column: "user_id", datatype: "string" },
  { column: "anonymous_id", datatype: "string" },
  { column: "event_name", datatype: "string" },
  { column: "country", datatype: "string" },
  { column: "device_category", datatype: "string" },
  { column: "source", datatype: "string" },
  { column: "medium", datatype: "string" },
  { column: "campaign", datatype: "string" },
  { column: "page_path", datatype: "string" },
  { column: "session_engaged", datatype: "string" },
  { column: "event_value_in_usd", datatype: "number" },
  { column: "session_id", datatype: "string" },
  { column: "engagement_time", datatype: "number" },
];

// BigQuery forbids these prefixes on real columns. Its INFORMATION_SCHEMA lists
// pseudo-columns like _PARTITIONTIME, which SELECT * never returns. Matched by
// name rather than is_hidden so table columns cached before the flag existed
// are covered too.
const BIGQUERY_RESERVED_PREFIX =
  /^(_TABLE_|_FILE_|_PARTITION|_ROW_TIMESTAMP|__ROOT__|_COLIDENTIFIER|_CHANGE_SEQUENCE_NUMBER|_CHANGE_TYPE|_CHANGE_TIMESTAMP)/i;

export const isPseudoColumn = (c: Column, datasourceType?: DataSourceType) =>
  datasourceType === "bigquery" && BIGQUERY_RESERVED_PREFIX.test(c.columnName);

export function getPickerTableColumns(
  table: SchemaBrowserTable,
  columns: Column[],
): DetectedColumn[] {
  return isGA4EventsTable(table)
    ? GA4_EVENTS_COLUMNS
    : columns.map((c) => ({
        column: c.columnName,
        datatype: mapDatabaseTypeToEnum(c.dataType),
      }));
}

// String partitions (Hive-style `dt`) can be any format, so only a partitioned
// timestamp is picked by default. BigQuery's _PARTITIONTIME holds the start of
// its hour, month or year, and a day-level bound would skip the month or year
// the range starts in. _PARTITIONDATE only exists on daily tables.
export function getDefaultPartitionColumn(
  columns: Column[],
  datasourceType?: DataSourceType,
): string {
  const partitioned = columns.find(
    (c) =>
      c.isPartition &&
      !isPseudoColumn(c, datasourceType) &&
      mapDatabaseTypeToEnum(c.dataType) === "date",
  );
  if (partitioned) return partitioned.columnName;
  if (datasourceType !== "bigquery") return "";
  return (
    columns.find((c) => c.columnName.toUpperCase() === "_PARTITIONDATE")
      ?.columnName ?? ""
  );
}

// Zero-padded and largest unit first, so values sort the same way dates do
const PARTITION_FORMATS = [
  "yyyy-MM-dd",
  "yyyyMMdd",
  "yyyy-MM",
  "yyyyMM",
  "yyyy",
];

// A date compares with a date literal; a number can't hold separators
export const getPartitionFormats = (datatype: FactTableColumnType) =>
  datatype === "date"
    ? []
    : PARTITION_FORMATS.filter(
        (f) => datatype !== "number" || !f.includes("-"),
      );

export type PartitionFilter = {
  column: string;
  datatype: FactTableColumnType;
  // From getPartitionFormats; ignored for dates
  format: string;
};

function getPartitionStart(
  { datatype, format }: PartitionFilter,
  datasourceType?: DataSourceType,
): string {
  if (datatype === "date") {
    const start = `'{{date startDateISO "yyyy-MM-dd"}}'`;
    // Athena doesn't coerce a string literal when comparing it to a date
    return datasourceType === "athena" ? `DATE ${start}` : start;
  }
  const start = `{{date startDateISO "${format}"}}`;
  return datatype === "number" ? start : `'${start}'`;
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Pruning filters only, lower bound only: metric queries bound the timestamp
export function getPickerTableSql(
  table: SchemaBrowserTable,
  {
    partition = null,
    datasourceType,
    identifierQuote = '"',
    columns = [],
    rowFilterWhere = "",
  }: {
    partition?: PartitionFilter | null;
    datasourceType?: DataSourceType;
    identifierQuote?: SqlIdentifierQuote;
    // Empty selects every column
    columns?: string[];
    // Compiled row filters, already joined with AND
    rowFilterWhere?: string;
  } = {},
): string {
  // GA4 picks its own columns; row filters read the raw export columns
  if (isGA4EventsTable(table)) {
    const sql = getGA4EventsSql(table.path);
    return rowFilterWhere ? `${sql}\n  AND ${rowFilterWhere}` : sql;
  }

  const quote = (c: string) =>
    SIMPLE_IDENTIFIER.test(c) ? c : quoteIdentifier(c, identifierQuote);

  const where = table.shards ? [shardFilter(table.hasIntraday)] : [];
  if (partition?.column) {
    where.push(
      `${quote(partition.column)} >= ${getPartitionStart(partition, datasourceType)}`,
    );
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

export function getDefaultTimestampColumn(columns: DetectedColumn[]): string {
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
