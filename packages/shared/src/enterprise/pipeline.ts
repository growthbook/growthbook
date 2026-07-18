import { getValidDate } from "shared/dates";
import {
  getExperimentOutdatedReasonLabel,
  isFactMetric,
  isExperimentOutdatedReasonField,
  quantileMetricType,
  ExperimentMetricDefinition,
} from "shared/experiments";
import type {
  DataSourceType,
  DataSourcePipelineMode,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import type { ExperimentInterface } from "shared/types/experiment";
import type { PipelineIntegration } from "shared/types/integrations";

// Keep this order stable: the settings hash depends on JSON.stringify key order.
export const INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS = [
  "activationMetric",
  "attributionModel",
  "queryFilter",
  "segment",
  "skipPartialData",
  "datasourceId",
  "exposureQueryId",
  "startDate",
  "regressionAdjustmentEnabled",
  "experimentId",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];

export type IncrementalFullRefreshComparable = Pick<
  ExperimentSnapshotSettings,
  (typeof INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS)[number]
>;

// Keep this aligned with snapshotSettings so UI labels match backend hash checks.
export function normalizeIncrementalFullRefreshField(
  field: (typeof INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS)[number],
  settings: IncrementalFullRefreshComparable,
): string | number | boolean | null {
  if (field === "startDate") {
    return getValidDate(settings.startDate).getTime();
  }
  if (field === "attributionModel") {
    return settings.attributionModel || "firstExposure";
  }
  const value = settings[field];
  return value ? value : null;
}

export function getIncrementalFullRefreshReasons(
  current: IncrementalFullRefreshComparable,
  baseline: IncrementalFullRefreshComparable,
): string[] {
  const reasons: string[] = [];
  for (const field of INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS) {
    if (!isExperimentOutdatedReasonField(field)) continue;

    const changed =
      normalizeIncrementalFullRefreshField(field, current) !==
      normalizeIncrementalFullRefreshField(field, baseline);

    if (changed) {
      reasons.push(getExperimentOutdatedReasonLabel(field));
    }
  }
  return reasons;
}

/**
 * Whether a data source's Incremental Pipeline configuration *covers* this
 * experiment: incremental writing is enabled and the experiment is in scope.
 * Datasource-level only; the experiment's type and per-config support are
 * checked separately. A `false` here means "not an incremental experiment",
 * which callers treat as silent (no fallback warning).
 */
export function isExperimentCoveredByIncrementalPipeline(
  settings: DataSourcePipelineSettings | undefined,
  experimentId: string,
): boolean {
  if (!settings || !settings.allowWriting) return false;

  return settings.mode === "incremental"
    ? !settings.excludedExperimentIds?.includes(experimentId) &&
        (settings.includedExperimentIds === undefined ||
          settings.includedExperimentIds.includes(experimentId))
    : (settings.incrementalOptInExperimentIds?.includes(experimentId) ?? false);
}

/**
 * The reason an experiment's *type* is unsupported by Incremental Pipeline
 * mode, or null when the type is supported. Bandit and holdout experiments
 * aren't supported yet.
 */
export function getUnsupportedIncrementalExperimentTypeReason(
  experimentType: ExperimentInterface["type"],
): string | null {
  if (experimentType !== undefined && experimentType !== "standard") {
    return `Experiment type "${experimentType}" is not supported for Incremental Pipeline mode.`;
  }
  return null;
}

/**
 * Whether an experiment is *covered* by a data source's Incremental Pipeline
 * configuration and has a supported type. Coverage is the first stage of
 * incremental resolution; per-experiment *support*
 * (`getIncrementalPipelineUnsupportedReason`) checks the rest, and a supported
 * experiment may still need a full (non-incremental) rescan to rebuild its
 * units table.
 *
 * Used at snapshot planning time (`resolveSnapshotRunner`) and validation time
 * (`assertIncrementalRefreshPrerequisites`).
 */
export function isExperimentIncrementalEnabled(
  settings: DataSourcePipelineSettings | undefined,
  experimentId: string,
  experimentType: ExperimentInterface["type"],
): boolean {
  return (
    isExperimentCoveredByIncrementalPipeline(settings, experimentId) &&
    getUnsupportedIncrementalExperimentTypeReason(experimentType) === null
  );
}

/**
 * The highest-priority reason this experiment can't run in Incremental Pipeline
 * mode, or null when it can. Combines coverage (delegated to
 * `isExperimentIncrementalEnabled`) with the per-experiment support checks
 * (in-progress conversions, activation metric, metrics, quantile sketches),
 * returning the first reason that applies.
 */
export function getIncrementalPipelineUnsupportedReason(params: {
  datasourceProperties:
    | {
        hasIncrementalRefresh?: boolean;
        hasQuantileSketch?: boolean;
      }
    | undefined;
  pipelineSettings: DataSourcePipelineSettings | undefined;
  experimentId: string;
  orgHasIncrementalPipelineFeature: boolean;
  skipPartialData: boolean;
  activationMetric: string | null | undefined;
  metrics: ExperimentMetricDefinition[];
  experimentType: ExperimentInterface["type"];
}): string | null {
  if (!params.orgHasIncrementalPipelineFeature) {
    return "Organization does not have access to Incremental Pipeline mode.";
  }

  if (!params.datasourceProperties?.hasIncrementalRefresh) {
    return "The data source does not support Incremental Pipeline mode.";
  }

  if (
    !isExperimentIncrementalEnabled(
      params.pipelineSettings,
      params.experimentId,
      params.experimentType,
    )
  ) {
    return "Incremental Pipeline mode is not enabled for this experiment.";
  }

  if (params.skipPartialData) {
    return "'Exclude In-Progress Conversions' is not supported with Incremental Pipeline mode while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.";
  }

  if (params.activationMetric) {
    return "Activation metrics are not supported with Incremental Pipeline mode while in beta. Please remove the Activation Metric in the Analysis Settings.";
  }

  if (params.metrics.length === 0) {
    return "Experiment must have at least 1 metric.";
  }

  if (params.metrics.some((m) => !isFactMetric(m))) {
    return "Legacy metrics aren't supported with Incremental Pipeline mode. Convert them or remove non-Fact Metrics.";
  }

  // Unit quantiles store a float and re-aggregate via SUM, so they work on
  // any incremental-capable warehouse. Only event quantiles need a quantile
  // sketch (the quantile must be computed over raw event values, which
  // requires a mergeable sketch for incremental aggregation).
  if (
    params.metrics.some(
      (metric) =>
        isFactMetric(metric) &&
        quantileMetricType(metric) === "event" &&
        !params.datasourceProperties?.hasQuantileSketch,
    )
  ) {
    return "Event quantile metrics are not supported with Incremental Pipeline mode on this data source.";
  }

  return null;
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

export const OVERALL_NON_INCREMENTAL_FULL_REFRESH_REASON =
  "Overall Results were last updated without the Incremental Pipeline";

// True when the latest Overall Results snapshot was not the incremental run
// that built the current units table.
export function overallResultsBuiltWithoutIncrementalPipeline({
  unitsTableFullName,
  materializedBySnapshotId,
  latestOverallSnapshotId,
}: {
  unitsTableFullName: string | null;
  materializedBySnapshotId: string | undefined;
  latestOverallSnapshotId: string | null;
}): boolean {
  if (!unitsTableFullName) return false;
  if (!materializedBySnapshotId) return false;
  if (!latestOverallSnapshotId) return false;
  return materializedBySnapshotId !== latestOverallSnapshotId;
}

export function isNewerOverallResultsDataAvailable(
  sourceSnapshot: SourceSnapshotRef | undefined,
  latestSuccessfulOverallResultsSnapshot:
    | Pick<ExperimentSnapshotInterface, "dateCreated">
    | undefined,
): boolean {
  if (!sourceSnapshot || !latestSuccessfulOverallResultsSnapshot) {
    return false;
  }

  return (
    getValidDate(latestSuccessfulOverallResultsSnapshot.dateCreated).getTime() >
    getValidDate(sourceSnapshot.dateCreated).getTime()
  );
}
