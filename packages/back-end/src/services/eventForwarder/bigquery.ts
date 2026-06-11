import * as bq from "@google-cloud/bigquery";
import {
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  isValidBigQueryTableName,
  normalizeBigQueryTableNameForEventForwarder,
} from "shared/util";
import { BigQueryEventForwarderStoredConfig } from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarder/config";
import { logger } from "back-end/src/util/logger";

const FEATURE_USAGE_TABLE = "feature_usage";

const TIME_PARTITIONING: bq.TableMetadata["timePartitioning"] = {
  type: "DAY",
  field: EVENT_FORWARDER_AVRO_PARTITION_FIELD,
};

/** Fields present on every forwarder table. */
const BASE_FIELDS: bq.TableField[] = [
  { name: "event_name", type: "STRING", mode: "REQUIRED" },
  { name: "event_uuid", type: "STRING", mode: "NULLABLE" },
  { name: "timestamp", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "received_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "client_key", type: "STRING", mode: "NULLABLE" },
  { name: "environment", type: "STRING", mode: "NULLABLE" },
];

const MAIN_TABLE_SCHEMA: bq.TableField[] = [
  ...BASE_FIELDS,
  { name: "sdk_language", type: "STRING", mode: "NULLABLE" },
  { name: "sdk_version", type: "STRING", mode: "NULLABLE" },
  { name: "ip", type: "STRING", mode: "NULLABLE" },
  { name: "geo_country", type: "STRING", mode: "NULLABLE" },
  { name: "geo_city", type: "STRING", mode: "NULLABLE" },
  { name: "geo_lat", type: "FLOAT64", mode: "NULLABLE" },
  { name: "geo_lon", type: "FLOAT64", mode: "NULLABLE" },
  { name: "experiment_id", type: "STRING", mode: "NULLABLE" },
  { name: "variation_id", type: "STRING", mode: "NULLABLE" },
  { name: "feature_key", type: "STRING", mode: "NULLABLE" },
  { name: "properties", type: "JSON", mode: "NULLABLE" },
  { name: "attributes", type: "JSON", mode: "NULLABLE" },
];

const EXPERIMENT_VIEWED_SCHEMA: bq.TableField[] = [
  ...BASE_FIELDS,
  { name: "experiment_id", type: "STRING", mode: "NULLABLE" },
  { name: "variation_id", type: "STRING", mode: "NULLABLE" },
  { name: "attributes", type: "JSON", mode: "NULLABLE" },
];

const FEATURE_USAGE_SCHEMA: bq.TableField[] = [
  ...BASE_FIELDS,
  { name: "feature_key", type: "STRING", mode: "NULLABLE" },
  { name: "attributes", type: "JSON", mode: "NULLABLE" },
];

type ServiceAccountKey = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function validateBigQueryTableName(tableName: string): void {
  if (!tableName) {
    throw new Error("Missing BigQuery event forwarder table name");
  }

  if (!isValidBigQueryTableName(tableName)) {
    throw new Error(
      "Event forwarder table name must be a valid BigQuery table name (letters, numbers, underscores; Unicode letters allowed).",
    );
  }
}

function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const trimmed = raw.trim();
  if (!trimmed)
    throw new Error("Missing service account key for BigQuery table creation");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Event forwarder service account key is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Event forwarder service account key is not valid JSON");
  }
  return parsed as ServiceAccountKey;
}

function buildBigQueryClient(
  projectId: string,
  serviceAccountKeyJson: string | undefined,
): bq.BigQuery {
  if (!serviceAccountKeyJson?.trim()) {
    return new bq.BigQuery({ projectId });
  }

  const key = parseServiceAccountKey(serviceAccountKeyJson);
  return new bq.BigQuery({
    projectId: key.project_id || projectId,
    credentials: {
      client_email: key.client_email,
      private_key: key.private_key,
    },
  });
}

async function ensureTable(
  dataset: bq.Dataset,
  tableName: string,
  schema: bq.TableField[],
): Promise<void> {
  const table = dataset.table(tableName);
  const [exists] = await table.exists();
  if (exists) {
    logger.info(
      { dataset: dataset.id, tableName },
      "Event forwarder BigQuery table already exists — skipping creation",
    );
    return;
  }

  await dataset.createTable(tableName, {
    schema,
    timePartitioning: TIME_PARTITIONING,
  });

  logger.info(
    { dataset: dataset.id, tableName },
    "Event forwarder BigQuery table created",
  );
}

/**
 * Resolves the BigQuery table name for the Confluent sink. Existing tables are reused.
 */
export async function resolveBigQueryEventForwarderTableName(
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<string> {
  const storedConfig =
    decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
      eventForwarderConfig,
    );

  const trimmed = storedConfig.tableName.trim();
  if (!trimmed) {
    throw new Error("Missing BigQuery event forwarder table name");
  }

  const baseTableName = normalizeBigQueryTableNameForEventForwarder(trimmed);

  if (!storedConfig.dataset) {
    throw new Error(
      "Missing BigQuery dataset needed for connector provisioning",
    );
  }

  validateBigQueryTableName(baseTableName);
  return baseTableName;
}

export type EnsureEventForwarderBigQueryTablesParams = {
  projectId: string;
  dataset: string;
  tableName: string;
  serviceAccountKey?: string;
};

/**
 * Idempotently creates the three BigQuery tables for an event forwarder:
 * - The main catch-all events table (user-defined name)
 * - `experiment_viewed` — dedicated table for Experiment Viewed events
 * - `feature_usage` — dedicated table for Feature Evaluated events
 *
 * All three are DAY-partitioned on `received_at`. `attributes` and `properties`
 * are stored as native BigQuery JSON columns.
 *
 * Called during provisioning before the Confluent connector is started, because
 * the connector is configured with `auto.create.tables=false`.
 */
export async function ensureEventForwarderBigQueryTables(
  params: EnsureEventForwarderBigQueryTablesParams,
): Promise<void> {
  const client = buildBigQueryClient(
    params.projectId,
    params.serviceAccountKey,
  );
  const ds = client.dataset(params.dataset);

  await Promise.all([
    ensureTable(ds, params.tableName, MAIN_TABLE_SCHEMA),
    ensureTable(
      ds,
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
      EXPERIMENT_VIEWED_SCHEMA,
    ),
    ensureTable(ds, FEATURE_USAGE_TABLE, FEATURE_USAGE_SCHEMA),
  ]);
}
