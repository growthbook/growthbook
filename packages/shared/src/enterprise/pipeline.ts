import type {
  DataSourceType,
  DataSourcePipelineMode,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import type { PipelineIntegration } from "shared/types/integrations";

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

export function getPipelineValidationCreateTableQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: PipelineIntegration;
}): string {
  return integration.getExperimentUnitsTableQueryFromCte(
    tableFullName,
    integration.getSampleUnitsCTE(),
  );
}

export function getPipelineValidationInsertQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: PipelineIntegration;
}): string {
  return integration.getPipelineValidationInsertQuery({ tableFullName });
}

export function getPipelineValidationDropTableQuery({
  tableFullName,
  integration,
}: {
  tableFullName: string;
  integration: PipelineIntegration;
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
