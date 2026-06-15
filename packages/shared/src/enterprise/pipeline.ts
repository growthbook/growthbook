import { getValidDate } from "shared/dates";
import type {
  DataSourceType,
  DataSourcePipelineMode,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { PipelineIntegration } from "shared/types/integrations";

/**
 * Single source of truth for whether an experiment runs with incremental
 * refresh on a given data source. Used at snapshot planning time
 * (`isIncrementalRefreshEnabledForSnapshot`) and validation time
 * (`assertIncrementalRefreshPrerequisites`).
 *
 * Resolution order:
 * 1. If `mode === "incremental"`, apply include/exclude semantics. Opt-in is
 *    ignored here — every experiment is already incremental by default, so
 *    `excludedExperimentIds` is the only meaningful per-experiment override.
 * 2. Else if the experiment is in `incrementalOptInExperimentIds`, it runs
 *    incremental (e.g. opting specific experiments into incremental while
 *    the default mode stays ephemeral).
 * 3. Otherwise, not incremental.
 */
export function isExperimentIncrementalEnabled(
  settings: DataSourcePipelineSettings | undefined,
  experimentId: string,
): boolean {
  if (!settings || !settings.allowWriting) return false;

  if (settings.mode === "incremental") {
    if (settings.excludedExperimentIds?.includes(experimentId)) return false;
    if (
      settings.includedExperimentIds !== undefined &&
      !settings.includedExperimentIds.includes(experimentId)
    ) {
      return false;
    }
    return true;
  }

  return (
    settings.incrementalOptInExperimentIds?.includes(experimentId) ?? false
  );
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
  incremental: ["bigquery", "presto", "snowflake"],
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

export function bigQueryCreateTablePartitions(
  columns: string[],
  opts?: { partitionByDate?: boolean; partitionExpirationDays?: number },
) {
  // BigQuery rejects TIMESTAMP_TRUNC on a DATE column, so partition DATE keys directly.
  // TODO(incremental-refresh): Is there a way to ensure the first argument is always a date/timestamp column?
  const partitionBy = opts?.partitionByDate
    ? `PARTITION BY \`${columns[0]}\``
    : `PARTITION BY TIMESTAMP_TRUNC(\`${columns[0]}\`, HOUR)`;

  // BigQuery auto-drops partitions once their date is older than this many days,
  // enforcing the retention window without a separate maintenance job.
  const options =
    opts?.partitionExpirationDays && opts.partitionExpirationDays > 0
      ? ` OPTIONS(partition_expiration_days = ${Math.floor(
          opts.partitionExpirationDays,
        )})`
      : "";

  // NB: BigQuery only supports one column for partitioning, so use cluster for the rest.
  if (columns.length === 1) {
    return `${partitionBy}${options}`;
  } else {
    const clusterBy = columns
      .slice(1)
      .map((column) => `\`${column}\``)
      .join(", ");

    return `${partitionBy} CLUSTER BY ${clusterBy}${options}`;
  }
}

export function prestoCreateTablePartitions(columns: string[]) {
  return `WITH (
    format = 'ORC',
    partitioned_by = ARRAY[${columns.map((column) => `'${column}'`).join(", ")}]
  )`;
}

/**
 * A reference to the upstream overall (dimensionless) results snapshot a
 * dimension breakdown was computed from, under Incremental Pipeline mode. A
 * subset of the snapshot's own fields so the UI can render without fetching the
 * full snapshot.
 */
export type SourceSnapshotRef = Pick<
  ExperimentSnapshotInterface,
  "id" | "dateCreated"
>;

/**
 * The upstream source reference for a snapshot, or undefined when the snapshot
 * was queried directly or never persisted its basis (legacy data before we added it).
 */
export function getExperimentSourceSnapshotRef(
  snapshot?: Pick<
    ExperimentSnapshotInterface,
    "sourceSnapshotId" | "sourceSnapshotDateCreated"
  >,
): SourceSnapshotRef | undefined {
  if (!snapshot?.sourceSnapshotId || !snapshot.sourceSnapshotDateCreated) {
    return undefined;
  }

  return {
    id: snapshot.sourceSnapshotId,
    dateCreated: getValidDate(snapshot.sourceSnapshotDateCreated),
  };
}
