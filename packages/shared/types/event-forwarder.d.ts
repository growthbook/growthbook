/**
 * Event forwarder sink types. bigquery and snowflake are Confluent Cloud managed
 * connectors; databricks is written by the GrowthBook-owned consumer (Zerobus).
 */
export type EventForwarderSinkType = "bigquery" | "snowflake" | "databricks";

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

/** Databricks sink settings edited in the event forwarder UI. */
export interface DatabricksEventForwarderConfigDraft {
  catalog: string;
  schema: string;
  tablePrefix: string;
  zerobusEndpoint: string;
}

/** Encrypted payload read by the consumer; connection fields are copied from datasource params at sync time. */
export interface DatabricksEventForwarderStoredConfig {
  catalog: string;
  schema: string;
  tablePrefix: string;
  zerobusEndpoint: string;
  /** Fully qualified `catalog.schema.table`, no backticks. */
  tables: { events: string; experiment_viewed: string; feature_usage: string };
  host: string;
  path: string;
  oauthClientId: string;
  oauthClientSecret: string;
}

export type EventForwarderConfigDraft =
  | {
      sinkType: "bigquery";
      config: BigQueryEventForwarderConfigDraft;
      /** AWS region to provision the forwarder's Kafka/Confluent resources in. Set once at creation. */
      region?: "us-east-1" | "eu-west-1";
    }
  | {
      sinkType: "snowflake";
      config: SnowflakeEventForwarderConfigDraft;
      /** AWS region to provision the forwarder's Kafka/Confluent resources in. Set once at creation. */
      region?: "us-east-1" | "eu-west-1";
    }
  | {
      sinkType: "databricks";
      config: DatabricksEventForwarderConfigDraft;
      /** AWS region to provision the forwarder's Kafka/Confluent resources in. Set once at creation. */
      region?: "us-east-1" | "eu-west-1";
    };

export type EventForwarderConfigWithMetadata = EventForwarderConfigDraft & {
  status: EventForwarderStatus;
  connectorName?: string;
  connectorId?: string;
  lastProvisioningError?: string;
};
