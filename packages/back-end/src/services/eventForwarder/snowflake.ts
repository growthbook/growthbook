import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  buildSnowflakeEventForwarderTableReference,
  resolveSnowflakeEventForwarderTableNames,
} from "shared/util";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
import { logger } from "back-end/src/util/logger";

// All three tables share one schema; the consumer sends the same envelope to each.
// Unquoted so Snowflake folds them to upper case, matching the fact-table SQL.
const EVENT_FORWARDER_SNOWFLAKE_COLUMNS = [
  "event_name STRING NOT NULL",
  "event_uuid STRING",
  "timestamp TIMESTAMP_NTZ",
  "received_at TIMESTAMP_NTZ",
  "client_key STRING",
  "environment STRING",
  "sdk_language STRING",
  "sdk_version STRING",
  "ip STRING",
  "geo_country STRING",
  "geo_city STRING",
  "geo_lat DOUBLE",
  "geo_lon DOUBLE",
  "experiment_id STRING",
  "variation_id STRING",
  "feature_key STRING",
  "properties VARIANT",
  "attributes VARIANT",
];

// Fails with "invalid identifier" when a pre-existing table lacks a contract column.
export function buildSnowflakeEventForwarderColumnCheckSql(
  tableRef: string,
): string {
  const columns = EVENT_FORWARDER_SNOWFLAKE_COLUMNS.map(
    (column) => column.split(" ")[0],
  );
  return `SELECT ${columns.join(", ")} FROM ${tableRef} LIMIT 0`;
}

export function buildSnowflakeEventForwarderCreateTableSql(
  tableRef: string,
): string {
  return `CREATE TABLE IF NOT EXISTS ${tableRef} (
  ${EVENT_FORWARDER_SNOWFLAKE_COLUMNS.join(",\n  ")}
)`;
}

// Snowpipe Streaming writes through each table's default pipe and never
// creates tables, so the app does before provisioning.
export async function ensureEventForwarderSnowflakeTables(
  params: SnowflakeConnectionParams,
  destination: { database: string; schema: string; tablePrefix: string },
): Promise<void> {
  const tableNames = resolveSnowflakeEventForwarderTableNames(
    destination.tablePrefix,
  );

  for (const tableName of Object.values(tableNames)) {
    const tableRef = buildSnowflakeEventForwarderTableReference(
      destination.database,
      destination.schema,
      tableName,
    );
    await runSnowflakeQuery(
      params,
      buildSnowflakeEventForwarderCreateTableSql(tableRef),
    );
    try {
      await runSnowflakeQuery(
        params,
        buildSnowflakeEventForwarderColumnCheckSql(tableRef),
      );
    } catch (e) {
      throw new Error(
        `Existing table ${tableRef} does not match the event forwarder schema. Drop it or choose another table prefix. (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    logger.info({ tableRef }, "Event forwarder Snowflake table ensured");
  }
}
