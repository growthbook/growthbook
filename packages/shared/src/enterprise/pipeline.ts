import type {
  DataSourceType,
  DataSourcePipelineMode,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import type { PipelineIntegration } from "shared/types/integrations";

/**
 * Determines whether a specific experiment should run with incremental refresh
 * for a data source's pipeline configuration. This is the single source of
 * truth for the gating logic and is used both at snapshot planning time
 * (`isIncrementalRefreshEnabledForSnapshot`) and at validation time
 * (`validateIncrementalPipeline`).
 *
 * Resolution order:
 * 1. If the experiment is in `incrementalOptInExperimentIds`, it always uses
 *    incremental (regardless of the default `mode`). The opt-in list is the
 *    explicit signal so it wins over `excludedExperimentIds`.
 * 2. If the default `mode` is `"incremental"`, fall back to the existing
 *    include/exclude semantics.
 * 3. Otherwise, incremental is not enabled for the experiment.
 */
export function isExperimentIncrementalEnabled(
  settings: DataSourcePipelineSettings | undefined,
  experimentId: string,
): boolean {
  if (!settings || !settings.allowWriting) return false;

  if (settings.incrementalOptInExperimentIds?.includes(experimentId)) {
    return true;
  }

  if (settings.mode !== "incremental") return false;

  if (settings.excludedExperimentIds?.includes(experimentId)) return false;

  if (
    settings.includedExperimentIds !== undefined &&
    !settings.includedExperimentIds.includes(experimentId)
  ) {
    return false;
  }

  return true;
}

/**
 * True when the data source has any experiments configured to use incremental
 * refresh — either by setting `mode === "incremental"` or by opting individual
 * experiments in. Used by the UI to decide whether to run incremental
 * permission validation before saving.
 */
export function pipelineRequiresIncrementalConfig(
  settings: DataSourcePipelineSettings | undefined,
): boolean {
  if (!settings) return false;
  if (settings.mode === "incremental") return true;
  return (settings.incrementalOptInExperimentIds?.length ?? 0) > 0;
}

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
