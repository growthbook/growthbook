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

// "other" is arrays, intervals and geo types, which don't slice sensibly
export const isDimensionCandidate = (c: DetectedColumn) =>
  ["string", "number", "boolean", ""].includes(c.datatype);

// The columns an object needs, beyond a timestamp and an identifier. A Fact
// Table needs nothing more; an assignment query also needs its experiment and
// variation ids.
export function getColumnMappingError(
  columns: DetectedColumn[],
  fromTable = false,
  {
    minColumns = 2,
    separateColumns = "separate timestamp and identifier columns",
  } = {},
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
  // roles have to be different columns.
  if (columns.length < minColumns) {
    return fromTable
      ? `Selected table must have ${separateColumns}.`
      : `Your query must return ${separateColumns}.`;
  }
  return null;
}

// A mapping survives as long as its column does; otherwise it's matched again
export const rematchColumn = (
  previous: string,
  columns: DetectedColumn[],
  match: () => string,
) => (columns.some((c) => c.column === previous) ? previous : match());

export const rematchUserIdColumns = (
  previous: Record<string, string>,
  identifierTypes: string[],
  columns: DetectedColumn[],
): Record<string, string> =>
  Object.fromEntries(
    identifierTypes.flatMap((idType) => {
      const column = rematchColumn(previous[idType] ?? "", columns, () =>
        findColumnByName(columns, idType),
      );
      return column ? [[idType, column]] : [];
    }),
  );

// Ignores case and separators, so userId matches user_id
const normalizeColumnName = (name: string) =>
  name.replace(/[^a-z]/gi, "").toLowerCase();

const EVENT_TYPE_COLUMNS = [
  "event_name",
  "eventName",
  "event_type",
  "eventType",
  "event",
  "se_action",
];

// Case-insensitive: Snowflake's information schema reports EVENT_NAME
export const findEventTypeColumn = (columns: DetectedColumn[]) =>
  EVENT_TYPE_COLUMNS.map((candidate) =>
    columns.find(
      (c) =>
        c.datatype === "string" &&
        c.column.toLowerCase() === candidate.toLowerCase(),
    ),
  ).find(Boolean)?.column ?? "";

// Closest match first, so user_id beats userId and user_id_2
export const findColumnByName = (columns: DetectedColumn[], name: string) =>
  (
    columns.find((c) => c.column === name) ??
    columns.find((c) => c.column.toLowerCase() === name.toLowerCase()) ??
    columns.find(
      (c) => normalizeColumnName(c.column) === normalizeColumnName(name),
    )
  )?.column ?? "";

export const haveSameColumnNames = (a: DetectedColumn[], b: DetectedColumn[]) =>
  a.length === b.length && a.every((c, i) => c.column === b[i].column);

// An identifier type whose column matches its own name resolves without a
// mapping, so only remapped types are stored.
export const getRemappedUserIdColumns = (
  userIdTypes: string[],
  userIdColumns: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    userIdTypes
      .filter((t) => userIdColumns[t] !== t)
      .map((t) => [t, userIdColumns[t]]),
  );

const tableSuffixFilter = (prefix: string) =>
  `(_TABLE_SUFFIX BETWEEN '${prefix}{{date startDateISO "yyyyMMdd"}}' AND '${prefix}{{date endDateISO "yyyyMMdd"}}')`;

export const shardFilter = (hasIntraday?: boolean) =>
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

// A table that gets a hand-written query instead of a generated SELECT
export type SourceTableTemplate = {
  matches: (table: SchemaBrowserTable) => boolean;
  name: string;
  // The information schema only knows the raw table's columns
  columns: DetectedColumn[];
  // Row filters read the raw table's columns
  getSql: (table: SchemaBrowserTable, rowFilterWhere: string) => string;
};

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

export const GA4_EVENTS_TEMPLATE: SourceTableTemplate = {
  matches: isGA4EventsTable,
  name: "GA4 Events",
  columns: GA4_EVENTS_COLUMNS,
  getSql: (table, rowFilterWhere) => {
    const sql = getGA4EventsSql(table.path);
    return rowFilterWhere ? `${sql}\n  AND ${rowFilterWhere}` : sql;
  },
};

export const getPickerTableColumns = (columns: Column[]): DetectedColumn[] =>
  columns.map((c) => ({
    column: c.columnName,
    datatype: mapDatabaseTypeToEnum(c.dataType),
  }));

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

export const getPickerTableName = (
  table: SchemaBrowserTable,
  template: SourceTableTemplate | null,
) => template?.name ?? table.tableName.replace(/_?\*$/, "");
