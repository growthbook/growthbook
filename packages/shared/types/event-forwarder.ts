export type EventForwarderSinkType = "bigquery" | "snowflake" | "databricks";

export type EventForwarderStatus = "pending" | "ready" | "error";

export interface BigQueryEventForwarderConfigDraft {
  projectId: string;
  dataset: string;
  tableName: string;
  serviceAccountKey?: string;
}

export type EventForwarderConfigDraft =
  | {
      sinkType: "bigquery";
      config: BigQueryEventForwarderConfigDraft;
    }
  | {
      sinkType: "snowflake";
      config: Record<string, string>;
    }
  | {
      sinkType: "databricks";
      config: Record<string, string>;
    };
