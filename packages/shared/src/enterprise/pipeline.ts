import type {
  DataSourceType,
  DataSourcePipelineSettings,
} from "back-end/types/datasource";
import type SqlIntegration from "back-end/src/integrations/SqlIntegration";

export type PipelineValidationResult = {
  result: "success" | "skipped" | "failed";
  resultMessage?: string;
};

// If optional, means the validation is not needed
export type PipelineValidationResults = {
  create: PipelineValidationResult;
  drop?: PipelineValidationResult;
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
  // return `CREATE TABLE ${tableFullName} (test_col ${this.getDataType(
  //   "string",
  // )}, created_at ${this.getDataType("timestamp")})`;

  const sampleUnitsCte = `__experimentUnits AS (
    SELECT 'user_1' AS user_id, 'A' AS variation, CURRENT_TIMESTAMP() AS first_exposure_timestamp
    UNION ALL
    SELECT 'user_2' AS user_id, 'B' AS variation, CURRENT_TIMESTAMP() AS first_exposure_timestamp
  )`;

  return integration.getExperimentUnitsTableQueryFromCte(
    tableFullName,
    sampleUnitsCte,
  );
}

// Insert
// return `INSERT INTO ${tableFullName} (test_col, created_at) VALUES ('growthbook', CURRENT_TIMESTAMP)`;

export function getPipelineValidationDropTableQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: SqlIntegration;
}): string {
  return integration.getDropUnitsTableQuery({
    fullTablePath: tableFullName,
  });
}
