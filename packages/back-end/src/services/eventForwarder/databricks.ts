import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import {
  buildDatabricksEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  resolveDatabricksEventForwarderTableNames,
} from "shared/util";
import { runDatabricksQuery } from "back-end/src/services/databricks";
import { logger } from "back-end/src/util/logger";

// All three tables share one schema; the consumer sends the same envelope to each.
const EVENT_FORWARDER_DATABRICKS_COLUMNS = [
  "event_name STRING NOT NULL",
  "event_uuid STRING",
  "timestamp TIMESTAMP",
  "received_at TIMESTAMP",
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

export function buildDatabricksEventForwarderCreateTableSql(
  tableRef: string,
): string {
  // VARIANT cannot be a clustering key, so cluster on received_at.
  return `CREATE TABLE IF NOT EXISTS ${tableRef} (
  ${EVENT_FORWARDER_DATABRICKS_COLUMNS.join(",\n  ")}
) USING DELTA CLUSTER BY (${EVENT_FORWARDER_AVRO_PARTITION_FIELD})`;
}

/**
 * Idempotently creates the three Delta tables for a Databricks event forwarder.
 * Zerobus never creates or evolves tables, so this runs before provisioning.
 */
export async function ensureEventForwarderDatabricksTables(
  params: DatabricksConnectionParams,
  destination: { catalog: string; schema: string; tablePrefix: string },
): Promise<void> {
  const tableNames = resolveDatabricksEventForwarderTableNames(
    destination.tablePrefix,
  );

  for (const tableName of Object.values(tableNames)) {
    const tableRef = buildDatabricksEventForwarderTableReference(
      destination.catalog,
      destination.schema,
      tableName,
    );
    await runDatabricksQuery(
      params,
      buildDatabricksEventForwarderCreateTableSql(tableRef),
    );
    logger.info({ tableRef }, "Event forwarder Databricks table ensured");
  }
}
