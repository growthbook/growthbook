import type { CreateColumnProps } from "shared/types/fact-table";

/** BigQuery daily partition column for BigQueryStorageSink (timestamp-millis). */
export const EVENT_FORWARDER_AVRO_PARTITION_FIELD = "received_at" as const;

export const EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX = "_events";
export const EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX = " Events";

export function sanitizeDatasourceNameForFactTableId(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!sanitized) {
    return "datasource";
  }

  if (!/^[a-z_]/.test(sanitized)) {
    return `_${sanitized}`;
  }

  return sanitized;
}

export function getEventForwarderEventsFactTableId(
  datasourceName: string,
): string {
  return `${sanitizeDatasourceNameForFactTableId(datasourceName)}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableIdWithCollisionSuffix(
  datasourceName: string,
  datasourceId: string,
): string {
  const prefix = sanitizeDatasourceNameForFactTableId(datasourceName);
  const idSuffix = datasourceId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toLowerCase();
  if (!idSuffix) {
    return `${prefix}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
  }
  return `${prefix}_${idSuffix}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableName(
  datasourceName: string,
): string {
  return `${datasourceName.trim()}${EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX}`;
}

export function isEventForwarderEventsFactTableCandidate(
  factTable: { id: string; name: string; managedBy?: string },
  datasourceName: string,
): boolean {
  if (factTable.managedBy !== "api") {
    return false;
  }

  const expectedName = getEventForwarderEventsFactTableName(datasourceName);
  if (factTable.name === expectedName) {
    return true;
  }

  const prefix = sanitizeDatasourceNameForFactTableId(datasourceName);
  return (
    factTable.id === getEventForwarderEventsFactTableId(datasourceName) ||
    (factTable.id.startsWith(`${prefix}_`) &&
      factTable.id.endsWith(EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX))
  );
}

export function buildBigQueryEventForwarderTableReference(
  projectId: string,
  dataset: string,
  tableName: string,
): string {
  return `\`${projectId.trim()}\`.\`${dataset.trim()}\`.\`${tableName.trim()}\``;
}

export function buildSnowflakeEventForwarderTableReference(
  database: string,
  schema: string,
  tableName: string,
): string {
  return `${database.trim()}.${schema.trim()}.${tableName.trim()}`;
}

export type BuildEventForwarderEventsFactTableSqlParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tableName: string;
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tableName: string;
    };

export function buildEventForwarderEventsFactTableSql(
  params: BuildEventForwarderEventsFactTableSqlParams,
): string {
  const partitionFilter = `${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;

  if (params.sinkType === "bigquery") {
    const tableRef = buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      params.tableName,
    );
    return `SELECT *\nFROM ${tableRef}\nWHERE ${partitionFilter}`;
  }

  const tableRef = buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    params.tableName,
  );

  return `SELECT *\nFROM ${tableRef}`;
}

export function buildEventForwarderEventsFactTableColumns(
  userIdTypes: string[],
): CreateColumnProps[] {
  const columns: CreateColumnProps[] = [];
  const seen = new Set<string>();

  for (const userIdType of userIdTypes) {
    const key = userIdType.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    columns.push({
      column: userIdType,
      name: userIdType,
      description: "",
      numberFormat: "",
      datatype: "string",
    });
  }

  return columns;
}
