export type EventForwarderSinkType = "bigquery" | "snowflake" | "databricks";

export type EventForwarderStatus = "pending" | "ready" | "error";

/** BigQuery sink settings edited with the datasource form (dataset is the datasource Default Dataset). */
export interface BigQueryEventForwarderConfigDraft {
  tableName: string;
  serviceAccountKey?: string;
}

/** Encrypted payload saved for provisioning; `dataset` is copied from datasource params at sync time. */
export interface BigQueryEventForwarderStoredConfig {
  dataset: string;
  tableName: string;
  serviceAccountKey?: string;
}

export interface SnowflakeEventForwarderConfigDraft {
  tableName: string;
  accessUrl?: string;
}

/** Encrypted payload saved for provisioning; credentials are copied from datasource params at sync time. */
export interface SnowflakeEventForwarderStoredConfig {
  tableName: string;
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
    }
  | {
      sinkType: "databricks";
      config: Record<string, string>;
    };
