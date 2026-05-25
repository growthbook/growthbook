import type { CreateColumnProps } from "shared/types/fact-table";

/** BigQuery daily partition column for BigQueryStorageSink (timestamp-millis). */
export const EVENT_FORWARDER_AVRO_PARTITION_FIELD = "received_at" as const;

/**
 * EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY — delay after schematization ping before
 * refreshing fact table columns and re-validating managed exposure / feature usage
 * queries. Increase here if warehouse tables need longer to materialize
 * (currently 1 min; was 5 min).
 */
export const EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS = 1 * 60 * 1000;

export const EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX = "_events";
export const EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX = " Events";

export function getEventForwarderEventsFactTableId(
  datasourceId: string,
): string {
  return `${datasourceId}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableName(
  datasourceName: string,
): string {
  return `${datasourceName.trim()}${EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX}`;
}

export function isEventForwarderEventsFactTable(
  factTable: { id: string; managedBy?: string },
  datasourceId: string,
): boolean {
  return (
    factTable.managedBy === "api" &&
    factTable.id === getEventForwarderEventsFactTableId(datasourceId)
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
