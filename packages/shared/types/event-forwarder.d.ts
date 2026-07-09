/**
 * Event forwarder sink types backed by Confluent Cloud managed connectors.
 * Reference implementations: bigquery, snowflake.
 */
export type EventForwarderSinkType = "bigquery" | "snowflake";

export type EventForwarderStatus =
  | "pending"
  | "ready"
  | "paused"
  | "error"
  | "schema_update_error";

/**
 * BigQuery sink settings edited in the event forwarder UI.
 * Stored config keeps separate project, dataset, and table prefix fields.
 */
export interface BigQueryEventForwarderConfigDraft {
  projectId: string;
  dataset: string;
  tablePrefix: string;
  serviceAccountKey?: string;
}

/** Encrypted payload saved for provisioning; credentials are copied from datasource params at sync time. */
export interface BigQueryEventForwarderStoredConfig {
  projectId?: string;
  dataset: string;
  tablePrefix: string;
  serviceAccountKey?: string;
}

/**
 * Snowflake sink settings edited in the event forwarder UI.
 * Stored config keeps separate database, schema, and tablePrefix fields.
 */
export interface SnowflakeEventForwarderConfigDraft {
  database: string;
  schema: string;
  tablePrefix: string;
  accessUrl?: string;
  role?: string;
  warehouse?: string;
}

/** Encrypted payload saved for provisioning; credentials are copied from datasource params at sync time. */
export interface SnowflakeEventForwarderStoredConfig {
  tablePrefix: string;
  account: string;
  accessUrl?: string;
  username: string;
  database: string;
  schema: string;
  privateKey: string;
  privateKeyPassword?: string;
  role?: string;
  warehouse?: string;
}

export type EventForwarderConfigDraft =
  | {
      sinkType: "bigquery";
      config: BigQueryEventForwarderConfigDraft;
    }
  | {
      sinkType: "snowflake";
      config: SnowflakeEventForwarderConfigDraft;
    };

export type EventForwarderConfigWithMetadata = EventForwarderConfigDraft & {
  status: EventForwarderStatus;
  connectorName?: string;
  connectorId?: string;
  lastProvisioningError?: string;
};
