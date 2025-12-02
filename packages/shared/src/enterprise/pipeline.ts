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
  insert?: PipelineValidationResult;
  drop?: PipelineValidationResult;
};

export const PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES: Record<
  DataSourcePipelineMode,
  DataSourceType[]
> = {
  ephemeral: ["bigquery", "databricks", "snowflake"],
  incremental: ["bigquery", "presto"],
};

export const UNITS_TABLE_RETENTION_HOURS_DEFAULT = 24;

export function bigQueryCreateTableOptions(
  settings: DataSourcePipelineSettings,
) {
  return `OPTIONS(
    expiration_timestamp=TIMESTAMP_ADD(
      CURRENT_TIMESTAMP(), 
      INTERVAL ${
        settings.unitsTableRetentionHours ?? UNITS_TABLE_RETENTION_HOURS_DEFAULT
      } HOUR
    )
  )`;
}

export function databricksCreateTableOptions(
  settings: DataSourcePipelineSettings,
) {
  return `OPTIONS(
    delta.deletedFileRetentionDuration='INTERVAL ${
      settings.unitsTableRetentionHours ?? UNITS_TABLE_RETENTION_HOURS_DEFAULT
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

export async function getPipelineValidationCreateTableQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: SqlIntegration;
}): Promise<string> {
  return await integration.getExperimentUnitsTableQueryFromCte(
    tableFullName,
    integration.getSampleUnitsCTE(),
  );
}

export function getPipelineValidationInsertQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: SqlIntegration;
}): string {
  return integration.getPipelineValidationInsertQuery({ tableFullName });
}

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

export function bigQueryCreateTablePartitions(columns: string[]) {
  // TODO(incremental-refresh): Is there a way to ensure the first argument is always a date column?
  const partitionBy = `PARTITION BY TIMESTAMP_TRUNC(\`${columns[0]}\`, HOUR)`;

  // NB: BigQuery only supports one column for partitioning, so use cluster for the rest.
  if (columns.length === 1) {
    return partitionBy;
  } else {
    const clusterBy = columns
      .slice(1)
      .map((column) => `\`${column}\``)
      .join(", ");

    return `${partitionBy} CLUSTER BY ${clusterBy}`;
  }
}

export function prestoCreateTablePartitions(columns: string[]) {
  return `WITH (
    format = 'ORC',
    partitioned_by = ARRAY[${columns.map((column) => `'${column}'`).join(", ")}]
  )`;
}
