import type {
  DataSourceType,
  DataSourcePipelineSettings,
} from "back-end/types/datasource";
import type SqlIntegration from "back-end/src/integrations/SqlIntegration";

export type PipelineValidationResult = {
  result: "success" | "skipped" | "failed";
  resultMessage?: string;
};

export type PipelineValidationResults = {
  create: PipelineValidationResult;
  insert: PipelineValidationResult;
  drop: PipelineValidationResult;
};

export const DATA_SOURCE_TYPES_THAT_SUPPORT_PIPELINE_MODE: readonly DataSourceType[] =
  ["bigquery", "databricks", "snowflake"] as const;

export const UNITS_TABLE_RETENTION_HOURS_DEFAULT = 24;

export function bigQueryCreateTableOptions(
  settings: DataSourcePipelineSettings,
) {
  return `OPTIONS(
        expiration_timestamp=TIMESTAMP_ADD(
          CURRENT_TIMESTAMP(), 
          INTERVAL ${
            settings.unitsTableRetentionHours ??
            UNITS_TABLE_RETENTION_HOURS_DEFAULT
          } HOUR
        )
      )`;
}

export function databricksCreateTableOptions(
  settings: DataSourcePipelineSettings,
) {
  return `OPTIONS(
        delta.deletedFileRetentionDuration='INTERVAL ${
          settings.unitsTableRetentionHours ??
          UNITS_TABLE_RETENTION_HOURS_DEFAULT
        } HOURS'
          )`;
}

export function snowflakeCreateTableOptions(
  settings: DataSourcePipelineSettings,
) {
  return `DATA_RETENTION_TIME_IN_DAYS = ${Math.ceil(
    (settings.unitsTableRetentionHours ?? UNITS_TABLE_RETENTION_HOURS_DEFAULT) /
      24,
  )}`;
}

export function getPipelineValidationCreateTableQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: SqlIntegration;
}): string {
  return `CREATE TABLE ${tableFullName} (test_col ${integration.getDataType(
    "string",
  )}, created_at ${integration.getDataType("timestamp")})`;
}

export function getPipelineValidationInsertQuery({
  tableFullName,
}: {
  tableFullName: string;
}): string {
  return `INSERT INTO ${tableFullName} (test_col, created_at) VALUES ('growthbook', CURRENT_TIMESTAMP)`;
}

export function getPipelineValidationDropTableQuery({
  tableFullName,
}: {
  tableFullName: string;
}): string {
  return `DROP TABLE IF EXISTS ${tableFullName}`;
}
