import isEqual from "lodash/isEqual";
import omitBy from "lodash/omitBy";
import pick from "lodash/pick";
import {
  getDefinitionMetricId,
  getMetricIdsMissingFromSnapshot,
  getNewMetricsUpdateBlocker,
  getNewMetricsUpdateSetupBlocker,
  getResultsOutdatedReasons,
  isWithinNewMetricsUpdateWindow,
  type NewMetricsUpdateBlocker,
} from "shared/experiments";
import { getSnapshotCutoffDate } from "shared/util";
import type { IncrementalRefreshInterface } from "shared/validators";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { StatsEngine } from "shared/types/stats";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import {
  findLatestSuccessfulOverallSnapshot,
  getLatestSnapshotStatus,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { isCarriedNewMetricsUpdateQuery } from "back-end/src/queryRunners/newMetricsUpdateQueryNaming";
import {
  assertCarriedQuerySqlUnchanged,
  type GenerateResultQuerySql,
} from "back-end/src/services/newMetricsUpdateSqlIdentity";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  NewMetricsUpdateOutsideWindowError,
  NewMetricsUpdateUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

export type NewMetricsUpdateWindow = { windowHours: number; now: Date };

/**
 * Plans a snapshot that queries only the experiment's metrics missing from
 * the latest successful Overall snapshot (its parent) and copies the
 * parent's query results for every other metric, pinned to the parent's end
 * date. Throws a typed error before anything is written, including
 * NewMetricsUpdateOutsideWindowError when the parent ends outside `window`.
 */
export async function planNewMetricsUpdate({
  context,
  experiment,
  datasource,
  phase,
  dimension,
  useCache,
  metricGroups,
  statsEngine,
  pValueThreshold,
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
  statsEngine: StatsEngine;
  pValueThreshold: number;
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
  const blockerArgs = {
    experiment,
    phase,
    separateExperimentResultQueries: !!getSourceIntegrationObject(
      context,
      datasource,
      true,
    ).getSourceProperties().separateExperimentResultQueries,
  };
  const setupBlocker = getNewMetricsUpdateSetupBlocker(blockerArgs);
  if (setupBlocker) {
    throw new NewMetricsUpdateUnavailableError(setupBlocker);
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
    throw new NewMetricsUpdateUnavailableError("no_base_snapshot");
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
    throw new NewMetricsUpdateOutsideWindowError();
  }
  // The app offers a new-metrics update only when "Metrics changed" is the one
  // Outdated reason, so the back end refuses on the same reasons.
  const outdatedReasons = getResultsOutdatedReasons({
    experiment,
    snapshot: parent,
    metricGroups,
    orgSettings: context.org.settings ?? {},
    pValueThreshold,
    statsEngine,
    features: {
      regressionAdjustment: orgHasPremiumFeature(
        context.org,
        "regression-adjustment",
      ),
      postStratification: orgHasPremiumFeature(
        context.org,
        "post-stratification",
      ),
      sequentialTesting: orgHasPremiumFeature(
        context.org,
        "sequential-testing",
      ),
    },
    phase,
    exposureQueries: datasource.settings.queries?.exposure ?? [],
    // Only "Metrics changed" reads these, and it never refuses.
    unjoinableMetricIds: new Set(),
    conversionWindowMetricIds: new Set(),
    // The parent is the latest Overall Results.
    newerOverallResultsAvailable: false,
    // Callers refuse frozen results before planning.
    resultsUpdateDisabled: false,
  });
  if (outdatedReasons.includes("analysis_dates_changed")) {
    throw new NewMetricsUpdateUnavailableError("analysis_dates_changed");
  }
  // A new-metrics update extends the parent's default analysis.
  if (parent.analyses[0]?.status !== "success") {
    throw new NewMetricsUpdateUnavailableError("base_incomplete");
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
        throw new NewMetricsUpdateUnavailableError("settings_changed");
      }
      throw error;
    },
  );
  // A new-metrics update appends to its parent's pipeline, on the Incremental
  // Pipeline to the tables the parent left, which an "incremental-full" run
  // would rebuild.
  const blocker = getNewMetricsUpdateBlocker({
    ...blockerArgs,
    pipelineChanged:
      plan.snapshot.runnerKind !==
      ((parent.runnerKind ?? "results") === "results"
        ? "results"
        : "incremental-update"),
  });
  if (blocker) {
    throw getBlockerRefusal(blocker, plan);
  }
  // The scheduled job stores CUPED as off when the experiment adjusts but every
  // metric opts out, and the badge then reports a CUPED change. A metric is
  // only adjusted when its own flag is on, so that reason changes no copied
  // number while every copied metric opts out.
  const allowedReasons = new Set<string>(["metrics_changed"]);
  if (noCopiedMetricIsAdjusted(parent.settings, plan.snapshot.settings)) {
    allowedReasons.add("cuped");
  }
  if (
    outdatedReasons.some((reason) => !allowedReasons.has(reason)) ||
    changesUnreasonedSetting(parent, plan.snapshot.settings)
  ) {
    throw new NewMetricsUpdateUnavailableError("settings_changed");
  }

  const { settings, queriedMetricIds } = mergeNewMetricsUpdateSettings({
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
    newMetricsUpdate: getNewMetricsUpdateLineage(parent, queriedMetricIds),
  };
  const carriedQueries = parent.queries.filter((q) =>
    isCarriedNewMetricsUpdateQuery(q.name, snapshot, snapshot.newMetricsUpdate),
  );
  if (carriedQueries.some((q) => q.status !== "succeeded")) {
    throw new NewMetricsUpdateUnavailableError("base_incomplete");
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

// What the back end knows beyond the shared rules: why the planned run is on
// another pipeline.
function getBlockerRefusal(
  blocker: NewMetricsUpdateBlocker,
  plan: Pick<PlannedExperimentSnapshot, "incrementalFallbackReason"> & {
    snapshot: Pick<PlannedExperimentSnapshot["snapshot"], "runnerKind">;
  },
): NewMetricsUpdateUnavailableError {
  if (blocker !== "metric_not_supported") {
    return new NewMetricsUpdateUnavailableError(blocker);
  }
  if (plan.snapshot.runnerKind === "incremental-full") {
    return new NewMetricsUpdateUnavailableError(
      "incremental_pipeline",
      'The Incremental Pipeline has no tables for this experiment\'s current settings yet, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" to build them.',
    );
  }
  return plan.incrementalFallbackReason
    ? new NewMetricsUpdateUnavailableError(
        "metric_not_supported",
        `The latest results ran on the Incremental Pipeline, which can't run this experiment now. ${plan.incrementalFallbackReason} Send "updateScope": "all_metrics" instead.`,
      )
    : new NewMetricsUpdateUnavailableError("metric_not_supported");
}

// Settings no Outdated reason covers whose change would make a copied result
// differ from a normal update's. Copied metrics keep the parent's analysis, so
// settings the stats engine reads count as well as those in the queries.
const UNREASONED_SETTINGS = [
  // The same SQL can run against another Data Source.
  "datasourceId",
  // Copied metrics keep the priors the parent analyzed them with.
  "defaultMetricPriorSettings",
  // The badge compares variation keys; the SRM check reads their weights.
  "variations",
  "coverage",
  // The tracking key the queries filter on.
  "experimentId",
  // The badge tolerates a day of drift; the queries start at this exact time.
  "startDate",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];
// Settings that only shape result query SQL. A results parent's update
// regenerates and compares that SQL; on the Incremental Pipeline the carried
// SQL only reads its tables, so they are compared here.
const UNREASONED_QUERY_SETTINGS = [
  "customFields",
  "dimensions",
  "lookbackOverride",
  "precomputedUnitDimensionIds",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];

const isEmptySetting = (value: unknown): boolean =>
  value === null ||
  value === false ||
  value === "" ||
  (typeof value === "object" && !Object.keys(value).length);

function noCopiedMetricIsAdjusted(
  parent: ExperimentSnapshotSettings,
  planned: ExperimentSnapshotSettings,
): boolean {
  const copiedMetricIds = new Set(parent.metricSettings.map((m) => m.id));
  const optsOut = (m: ExperimentSnapshotSettings["metricSettings"][number]) =>
    m.computedSettings?.regressionAdjustmentEnabled === false;
  return (
    parent.metricSettings.every(optsOut) &&
    planned.metricSettings
      .filter((m) => copiedMetricIds.has(m.id))
      .every(optsOut)
  );
}

// A setting one side lacks counts as that setting left empty.
function changesUnreasonedSetting(
  parent: Pick<ExperimentSnapshotInterface, "settings" | "runnerKind">,
  planned: ExperimentSnapshotSettings,
): boolean {
  const keys: string[] = [
    ...UNREASONED_SETTINGS,
    ...((parent.runnerKind ?? "results") === "results"
      ? []
      : UNREASONED_QUERY_SETTINGS),
  ];
  const comparable = (settings: ExperimentSnapshotSettings) =>
    omitBy(JSON.parse(JSON.stringify(pick(settings, keys))), isEmptySetting);
  const before = comparable(parent.settings);
  const after = comparable(planned);
  return keys.some((key) => !isEqual(before[key], after[key]));
}

/**
 * Settings for the new-metrics update: planned entries for the target metrics
 * and their slices and funnel steps, the parent's stored entries verbatim for
 * every other metric. Any other planned entry the parent lacks is dropped.
 */
export function mergeNewMetricsUpdateSettings({
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

export function getNewMetricsUpdateLineage(
  parent: Pick<
    ExperimentSnapshotInterface,
    "id" | "dateCreated" | "runStarted" | "settings" | "newMetricsUpdate"
  >,
  metricIds: string[],
): SnapshotNewMetricsUpdate {
  const root = parent.newMetricsUpdate
    ? {
        baseDateCreated: parent.newMetricsUpdate.baseDateCreated,
        baseRunStarted: parent.newMetricsUpdate.baseRunStarted,
        baseCutoffDate: parent.newMetricsUpdate.baseCutoffDate,
      }
    : {
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
 * up to the parent's end as well, so the new-metrics update reads them like
 * the others.
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
    throw new NewMetricsUpdateUnavailableError("incremental_pipeline");
  }
}

/** Checks, under the run's lock, the tables an incremental refresh reads. */
export async function assertIncrementalNewMetricsUpdateBase({
  context,
  snapshot,
  newMetricsUpdate,
}: {
  context: ReqContext | ApiReqContext;
  snapshot: PlannedExperimentSnapshot["snapshot"];
  newMetricsUpdate: SnapshotNewMetricsUpdate;
}): Promise<void> {
  assertIncrementalTablesMatchParent({
    state: await context.models.incrementalRefresh.getLockedBySnapshotId(
      snapshot.experiment,
      snapshot.id,
    ),
    parentSnapshotId: newMetricsUpdate.parentSnapshotId,
    scanEnd: snapshot.settings.endDate,
  });
}
