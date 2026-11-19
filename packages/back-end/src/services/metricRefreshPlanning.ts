import isEqual from "lodash/isEqual";
import omitBy from "lodash/omitBy";
import {
  getDefinitionMetricId,
  getMetricIdsMissingFromSnapshot,
  getSnapshotDataAsOf,
  isAnalysisDateRangeOutdated,
  isWithinNewMetricsUpdateWindow,
} from "shared/experiments";
import {
  getIdentifierTypeForSettingsHash,
  getSnapshotCutoffDate,
} from "shared/util";
import type { IncrementalRefreshInterface } from "shared/validators";
import type {
  DataSourceInterface,
  ExposureQuery,
} from "shared/types/datasource";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetricRefresh,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import {
  findLatestSuccessfulOverallSnapshot,
  getLatestSnapshotStatus,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { isCarriedMetricRefreshQuery } from "back-end/src/queryRunners/metricRefreshQueryNaming";
import {
  assertCarriedQuerySqlUnchanged,
  type GenerateResultQuerySql,
} from "back-end/src/services/metricRefreshSqlIdentity";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

export type NewMetricsUpdateWindow = { windowHours: number; now: Date };

/**
 * Plans a snapshot that queries only the experiment's metrics missing from
 * the latest successful Overall snapshot (its parent) and copies the
 * parent's query results for every other metric, pinned to the parent's end
 * date. Throws a typed error before anything is written, including
 * MetricRefreshOutsideWindowError when the parent ends outside `window`.
 */
export async function planMetricRefresh({
  context,
  experiment,
  datasource,
  phase,
  dimension,
  useCache,
  metricGroups,
  planSnapshotAt,
  generateResultQuerySql,
  window,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  phase: number;
  dimension: string | undefined;
  useCache: boolean;
  metricGroups: MetricGroupInterface[];
  planSnapshotAt: (cutoff: Date) => Promise<PlannedExperimentSnapshot>;
  generateResultQuerySql: GenerateResultQuerySql;
  window?: NewMetricsUpdateWindow;
}): Promise<PlannedExperimentSnapshot> {
  if (dimension) {
    throw new BadRequestError(
      "Updating newly added metrics can't be combined with a dimension.",
    );
  }
  if (!useCache) {
    throw new BadRequestError(
      "Updating newly added metrics can't be combined with a forced rerun.",
    );
  }
  if ((experiment.type ?? "standard") !== "standard") {
    throw new MetricRefreshUnavailableError("unsupported_experiment_type");
  }
  if (phase !== experiment.phases.length - 1) {
    throw new MetricRefreshUnavailableError("not_latest_phase");
  }
  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    throw new MetricRefreshUnavailableError("unsupported_data_source");
  }

  const latest = await getLatestSnapshotStatus({
    context,
    experiment: experiment.id,
    phase,
    type: "standard",
  });
  if (latest?.status === "running") {
    throw new SnapshotInProgressError(latest.id);
  }

  const parent = await findLatestSuccessfulOverallSnapshot(context, {
    experiment: experiment.id,
    phase,
  });
  if (!parent) {
    throw new MetricRefreshUnavailableError("no_base_snapshot");
  }

  const missingMetricIds = getMetricIdsMissingFromSnapshot({
    experiment,
    snapshotSettings: parent.settings,
    metricGroups,
  });
  if (!missingMetricIds.length) {
    throw new MetricsAlreadyUpToDateError(parent.id);
  }
  if (
    window &&
    !isWithinNewMetricsUpdateWindow({
      ...window,
      resultsEndDate: parent.settings.endDate,
    })
  ) {
    throw new MetricRefreshOutsideWindowError();
  }
  if (
    isAnalysisDateRangeOutdated({
      phase: experiment.phases[phase],
      snapshotSettings: parent.settings,
      snapshotDateCreated: getSnapshotDataAsOf(parent),
    })
  ) {
    throw new MetricRefreshUnavailableError("analysis_dates_changed");
  }
  // A refresh extends the parent's default analysis.
  if (parent.analyses[0]?.status !== "success") {
    throw new MetricRefreshUnavailableError("base_incomplete");
  }

  // Planning reports tables past the cutoff as changed settings, so check the
  // tables a later run may have left first.
  if ((parent.runnerKind ?? "results") !== "results") {
    assertIncrementalTablesMatchParent({
      state: await context.models.incrementalRefresh.getByExperimentIdAndPhase(
        experiment.id,
        phase,
      ),
      parentSnapshotId: parent.id,
      scanEnd: parent.settings.endDate,
    });
  }
  const plan = await planSnapshotAt(parent.settings.endDate).catch(
    (error: unknown) => {
      if (
        error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError
      ) {
        throw new MetricRefreshUnavailableError("settings_changed");
      }
      throw error;
    },
  );
  if (!getSnapshotCutoffDate(plan.snapshot.settings)) {
    throw new MetricRefreshUnavailableError("phase_ended");
  }
  assertRefreshablePipeline({ parent, plan });
  if (
    getSettingsChangedSinceParent({
      parent,
      planned: plan.snapshot,
      exposureQueries: datasource.settings.queries?.exposure ?? [],
    }).length
  ) {
    throw new MetricRefreshUnavailableError("settings_changed");
  }

  const { settings, queriedMetricIds } = mergeMetricRefreshSettings({
    parent: parent.settings,
    planned: plan.snapshot.settings,
    targetMetricIds: missingMetricIds,
  });
  if (!queriedMetricIds.length) {
    throw new MetricsAlreadyUpToDateError(parent.id);
  }
  const snapshot = {
    ...plan.snapshot,
    settings,
    metricRefresh: getMetricRefreshLineage(parent, queriedMetricIds),
  };
  const carriedQueries = parent.queries.filter((q) =>
    isCarriedMetricRefreshQuery(q.name, snapshot, snapshot.metricRefresh),
  );
  if (carriedQueries.some((q) => q.status !== "succeeded")) {
    throw new MetricRefreshUnavailableError("base_incomplete");
  }
  // The Incremental Pipeline's carried SQL only reads its cache tables, so
  // identical text there would prove nothing about the metrics behind them.
  if ((parent.runnerKind ?? "results") === "results") {
    await assertCarriedQuerySqlUnchanged({
      context,
      parent,
      planned: plan.snapshot.settings,
      carriedQueries,
      generateResultQuerySql,
    });
  }

  return { ...plan, snapshot };
}

function assertRefreshablePipeline({
  parent,
  plan,
}: {
  parent: Pick<ExperimentSnapshotInterface, "runnerKind">;
  plan: Pick<PlannedExperimentSnapshot, "incrementalFallbackReason"> & {
    snapshot: Pick<PlannedExperimentSnapshot["snapshot"], "runnerKind">;
  };
}): void {
  const parentKind = parent.runnerKind ?? "results";
  const expected = parentKind === "results" ? "results" : "incremental-update";
  if (plan.snapshot.runnerKind === expected) return;
  // The pipeline runs this experiment but has no tables to append to.
  if (plan.snapshot.runnerKind === "incremental-full") {
    throw new MetricRefreshUnavailableError(
      "incremental_pipeline",
      'The Incremental Pipeline has no tables for this experiment\'s current settings yet, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" to build them.',
    );
  }
  throw plan.incrementalFallbackReason
    ? new MetricRefreshUnavailableError(
        "metric_not_supported",
        `The latest results ran on the Incremental Pipeline, which can't run this experiment now. ${plan.incrementalFallbackReason} Send "updateScope": "all_metrics" instead.`,
      )
    : new MetricRefreshUnavailableError("metric_not_supported");
}

const REFRESH_SPECIFIC_SETTINGS = [
  "metricSettings",
  "goalMetrics",
  "secondaryMetrics",
  "guardrailMetrics",
  "clusterLevelMetricIds",
  "endDateIsCutoff",
  "manual",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];
// Settings the stats engine never reads and the Outdated badge doesn't count:
// they only shape result query SQL, which a results parent's refresh
// regenerates and compares instead. A setting the badge counts is compared on
// both pipelines, because changing it can leave the SQL as it was (the
// attribution model, when no metric has a conversion window). The badge's
// CUPED reason reads the analysis's regressionAdjusted, compared below.
const SETTINGS_ONLY_IN_RESULT_QUERY_SQL = [
  "customFields",
  "dimensions",
  "lookbackOverride",
  "phase",
  "precomputedUnitDimensionIds",
  "regressionAdjustmentEnabled",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];
const METRIC_COUNT_ANALYSIS_SETTINGS = [
  "numGoalMetrics",
  "numGuardrailMetrics",
] as const satisfies readonly (keyof ExperimentSnapshotAnalysisSettings)[];

const isEmptySetting = (value: unknown): boolean =>
  value === null ||
  value === false ||
  value === "" ||
  (typeof value === "object" && !Object.keys(value).length);

function getChangedKeys(
  before: object,
  after: object,
  ignored: readonly string[],
): string[] {
  const withoutEmptySettings = (value: object): Record<string, unknown> =>
    omitBy(JSON.parse(JSON.stringify(value)), isEmptySetting);
  const a = withoutEmptySettings(before);
  const b = withoutEmptySettings(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => !ignored.includes(key) && !isEqual(a[key], b[key]),
  );
}

/**
 * The parent's settings a refresh would not honor if it copied the parent's
 * results. On the standard pipeline this leaves the analysis settings, the
 * snapshot settings the stats engine reads and those behind an Outdated
 * reason; the carried SQL check covers the rest.
 */
export function getSettingsChangedSinceParent({
  parent,
  planned,
  exposureQueries,
}: {
  parent: Pick<
    ExperimentSnapshotInterface,
    "settings" | "analyses" | "runnerKind"
  >;
  planned: Pick<ExperimentSnapshotInterface, "settings" | "analyses">;
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[];
}): string[] {
  // The scheduled job and a manual update derive the snapshot-level flags
  // differently when the experiment adjusts but every metric opts out. A metric
  // is only adjusted when its own flag is on too, so that difference changes no
  // number, as long as the plan would not start adjusting a copied metric.
  const copiedMetricIds = new Set(
    parent.settings.metricSettings.map((m) => m.id),
  );
  const optsOut = (m: ExperimentSnapshotSettings["metricSettings"][number]) =>
    m.computedSettings?.regressionAdjustmentEnabled === false;
  const noCopiedMetricIsAdjusted =
    parent.settings.metricSettings.every(optsOut) &&
    planned.settings.metricSettings
      .filter((m) => copiedMetricIds.has(m.id))
      .every(optsOut);
  const comparable = (settings: ExperimentSnapshotSettings) => ({
    ...settings,
    exposureQueryIdentifierType: getIdentifierTypeForSettingsHash(
      settings.exposureQueryId,
      settings.exposureQueryIdentifierType,
      exposureQueries,
    ),
  });
  return [
    ...getChangedKeys(
      comparable(parent.settings),
      comparable(planned.settings),
      [
        ...REFRESH_SPECIFIC_SETTINGS,
        ...((parent.runnerKind ?? "results") === "results"
          ? SETTINGS_ONLY_IN_RESULT_QUERY_SQL
          : noCopiedMetricIsAdjusted
            ? ["regressionAdjustmentEnabled"]
            : []),
      ],
    ),
    ...getChangedKeys(
      parent.analyses[0]?.settings ?? {},
      planned.analyses[0]?.settings ?? {},
      [
        ...METRIC_COUNT_ANALYSIS_SETTINGS,
        ...(noCopiedMetricIsAdjusted ? ["regressionAdjusted"] : []),
      ],
    ).map((key) => `analysis.${key}`),
  ];
}

/**
 * Settings for the refresh: planned entries for the target metrics and their
 * slices and funnel steps, the parent's stored entries verbatim for every
 * other metric. Any other planned entry the parent lacks is dropped.
 */
export function mergeMetricRefreshSettings({
  parent,
  planned,
  targetMetricIds,
}: {
  parent: ExperimentSnapshotSettings;
  planned: ExperimentSnapshotSettings;
  targetMetricIds: readonly string[];
}): { settings: ExperimentSnapshotSettings; queriedMetricIds: string[] } {
  const targets = new Set(targetMetricIds);
  const isTarget = (id: string) => targets.has(getDefinitionMetricId(id));
  const parentEntries = new Map(parent.metricSettings.map((m) => [m.id, m]));

  const metricSettings = planned.metricSettings.flatMap((entry) => {
    if (isTarget(entry.id)) return [entry];
    const carried = parentEntries.get(entry.id);
    return carried ? [carried] : [];
  });
  const kept = new Set(metricSettings.map((m) => m.id));
  const queried = new Set(
    metricSettings
      .map((m) => getDefinitionMetricId(m.id))
      .filter((id) => targets.has(id)),
  );

  const settings: ExperimentSnapshotSettings = { ...planned, metricSettings };
  if (planned.clusterLevelMetricIds || parent.clusterLevelMetricIds) {
    settings.clusterLevelMetricIds = [
      ...(parent.clusterLevelMetricIds ?? []).filter(
        (id) => kept.has(id) && !isTarget(id),
      ),
      ...(planned.clusterLevelMetricIds ?? []).filter(isTarget),
    ];
  }

  return {
    settings,
    queriedMetricIds: targetMetricIds.filter((id) => queried.has(id)),
  };
}

export function getMetricRefreshLineage(
  parent: Pick<
    ExperimentSnapshotInterface,
    "id" | "dateCreated" | "runStarted" | "settings" | "metricRefresh"
  >,
  metricIds: string[],
): SnapshotMetricRefresh {
  const root = parent.metricRefresh
    ? {
        baseSnapshotId: parent.metricRefresh.baseSnapshotId,
        baseDateCreated: parent.metricRefresh.baseDateCreated,
        baseRunStarted: parent.metricRefresh.baseRunStarted,
        baseCutoffDate: parent.metricRefresh.baseCutoffDate,
      }
    : {
        baseSnapshotId: parent.id,
        baseDateCreated: parent.dateCreated,
        baseRunStarted: parent.runStarted,
        baseCutoffDate: getSnapshotCutoffDate(parent.settings),
      };
  return { ...root, parentSnapshotId: parent.id, metricIds };
}

/**
 * Accepts the pipeline state only when every stored table still holds no data
 * past the parent's end and the parent is the last run that succeeded on it.
 * A failed run since then may have rebuilt some caches; those hold data only
 * up to the parent's end as well, so the refresh reads them like the others.
 */
export function assertIncrementalTablesMatchParent({
  state,
  parentSnapshotId,
  scanEnd,
}: {
  state: Pick<
    IncrementalRefreshInterface,
    | "unitsTableFullName"
    | "unitsMaxTimestamp"
    | "materializedBySnapshotId"
    | "metricSources"
  > | null;
  parentSnapshotId: string;
  scanEnd: Date;
}): void {
  const pastScanEnd = (timestamp: Date | null) =>
    !!timestamp && timestamp > scanEnd;
  const tablesMatchParent =
    !!state?.unitsTableFullName &&
    state.materializedBySnapshotId === parentSnapshotId &&
    ![
      state.unitsMaxTimestamp,
      ...state.metricSources.map((s) => s.maxTimestamp),
    ].some(pastScanEnd);
  if (!tablesMatchParent) {
    throw new MetricRefreshUnavailableError("incremental_pipeline");
  }
}

/** Checks, under the run's lock, the tables an incremental refresh reads. */
export async function assertIncrementalMetricRefreshBase({
  context,
  snapshot,
  metricRefresh,
}: {
  context: ReqContext | ApiReqContext;
  snapshot: PlannedExperimentSnapshot["snapshot"];
  metricRefresh: SnapshotMetricRefresh;
}): Promise<void> {
  assertIncrementalTablesMatchParent({
    state: await context.models.incrementalRefresh.getLockedBySnapshotId(
      snapshot.experiment,
      snapshot.id,
    ),
    parentSnapshotId: metricRefresh.parentSnapshotId,
    scanEnd: snapshot.settings.endDate,
  });
}
