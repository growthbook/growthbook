import type {
  DataSourceType,
  DataSourcePipelineMode,
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

export const PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES: Record<
  DataSourcePipelineMode,
  DataSourceType[]
> = {
  ephemeral: ["bigquery", "databricks", "snowflake"],
  incremental: ["presto"],
};

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

  // TODO: Validate it current_timestamp(0) works with BigQuery
  const sampleUnitsCte = `__experimentUnits AS (
    SELECT 'user_1' AS user_id, 'A' AS variation, cast(CURRENT_TIMESTAMP(0) as timestamp) AS first_exposure_timestamp
    UNION ALL
    SELECT 'user_2' AS user_id, 'B' AS variation, cast(CURRENT_TIMESTAMP(0) as timestamp) AS first_exposure_timestamp
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

export function getRequiredColumnsForPipelineSettings(
  settings: DataSourcePipelineSettings,
): string[] {
  const partitionSettings = settings.partitionSettings;
  const type = partitionSettings?.type;
  if (!type) return [];

  switch (type) {
    case "yearMonthDay":
      return [
        partitionSettings.yearColumn,
        partitionSettings.monthColumn,
        partitionSettings.dayColumn,
      ];

    case "date":
      return [partitionSettings.dateColumn];

    case "timestamp":
      return [];

    default:
      return (type satisfies never) ? [] : [];
  }
}

// Incremental Refresh
export function trinoCreateTablePartitions(
  columns: string[],
) {
  return `WITH (
    format = 'ORC',
    partitioned_by = ARRAY[${columns.map((column) => `'${column}'`).join(", ")}]
  )`;
}
