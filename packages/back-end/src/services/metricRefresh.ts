import isEqual from "lodash/isEqual";
import omitBy from "lodash/omitBy";
import {
  getDefinitionMetricId,
  getMetricIdsMissingFromSnapshot,
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
import type { Queries, QueryPointer } from "shared/types/query";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import {
  findLatestSuccessfulOverallSnapshot,
  getLatestSnapshotStatus,
  getSnapshotQueryPointers,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  createNewQueryFromCached,
  getQueriesByIds,
} from "back-end/src/models/QueryModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { isCarriedMetricRefreshQuery } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { isCarriedIncrementalQuery } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  MetricRefreshUnavailableError,
  MetricRefreshUnavailableReason,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

const UNAVAILABLE_MESSAGES: Record<MetricRefreshUnavailableReason, string> = {
  no_base_snapshot:
    "This experiment has no results to add metrics to yet. Run a full update first.",
  not_latest_phase:
    "Only the current phase's results can be updated for newly added metrics.",
  phase_ended:
    "This phase has ended, so newly added metrics can't be updated on their own. Run a full update instead.",
  unsupported_experiment_type:
    "Bandits and holdouts can't update newly added metrics on their own. Run a full update instead.",
  unsupported_data_source:
    "This Data Source analyzes every metric in one query, so newly added metrics can't be updated on their own. Run a full update instead.",
  incremental_pipeline:
    "The experiment's pipeline tables no longer match its latest results, so newly added metrics can't be updated on their own. Run a full update instead.",
  settings_changed:
    "The experiment's analysis settings changed since the last update. Run a full update instead.",
  base_incomplete:
    "Some queries of the last update failed, so its results can't be reused. Run a full update instead.",
};

function unavailable(
  reason: MetricRefreshUnavailableReason,
): MetricRefreshUnavailableError {
  return new MetricRefreshUnavailableError(
    reason,
    UNAVAILABLE_MESSAGES[reason],
  );
}

/**
 * Plans a snapshot that queries only the experiment's metrics missing from
 * the latest successful Overall snapshot (its parent) and copies the
 * parent's query results for every other metric, pinned to the parent's end
 * date. Throws a typed error before anything is written.
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
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  phase: number;
  dimension: string | undefined;
  useCache: boolean;
  metricGroups: MetricGroupInterface[];
  planSnapshotAt: (cutoff: Date) => Promise<PlannedExperimentSnapshot>;
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
    throw unavailable("unsupported_experiment_type");
  }
  if (phase !== experiment.phases.length - 1) {
    throw unavailable("not_latest_phase");
  }
  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    throw unavailable("unsupported_data_source");
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
    throw unavailable("no_base_snapshot");
  }

  const missingMetricIds = getMetricIdsMissingFromSnapshot({
    experiment,
    snapshotSettings: parent.settings,
    metricGroups,
  });
  if (!missingMetricIds.length) {
    throw new MetricsAlreadyUpToDateError(parent.id);
  }

  const plan = await planSnapshotAt(parent.settings.endDate).catch(
    (error: unknown) => {
      if (
        error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError
      ) {
        throw unavailable("settings_changed");
      }
      throw error;
    },
  );
  if (!getSnapshotCutoffDate(plan.snapshot.settings)) {
    throw unavailable("phase_ended");
  }
  assertRefreshablePipeline({ parent, planned: plan.snapshot });
  if (
    getSettingsChangedSinceParent({
      parent,
      planned: plan.snapshot,
      exposureQueries: datasource.settings.queries?.exposure ?? [],
    }).length
  ) {
    throw unavailable("settings_changed");
  }

  const { settings, queriedMetricIds } = mergeMetricRefreshSettings({
    parent: parent.settings,
    planned: plan.snapshot.settings,
    targetMetricIds: missingMetricIds,
  });
  if (!queriedMetricIds.length) {
    throw new MetricsAlreadyUpToDateError(parent.id);
  }
  const analyzedMetricIds = new Set(settings.metricSettings.map((m) => m.id));
  const isCarried =
    (parent.runnerKind ?? "results") === "results"
      ? (name: string) =>
          isCarriedMetricRefreshQuery(name, parent.id, analyzedMetricIds)
      : isCarriedIncrementalQuery;
  if (
    parent.queries.some((q) => q.status !== "succeeded" && isCarried(q.name))
  ) {
    throw unavailable("base_incomplete");
  }

  return {
    ...plan,
    snapshot: {
      ...plan.snapshot,
      settings,
      metricRefresh: getMetricRefreshLineage(parent, queriedMetricIds),
    },
  };
}

function assertRefreshablePipeline({
  parent,
  planned,
}: {
  parent: Pick<ExperimentSnapshotInterface, "runnerKind">;
  planned: Pick<PlannedExperimentSnapshot["snapshot"], "runnerKind">;
}): void {
  const parentKind = parent.runnerKind ?? "results";
  const expected = parentKind === "results" ? "results" : "incremental-update";
  if (planned.runnerKind !== expected) {
    throw unavailable("incremental_pipeline");
  }
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

export function getSettingsChangedSinceParent({
  parent,
  planned,
  exposureQueries,
}: {
  parent: Pick<ExperimentSnapshotInterface, "settings" | "analyses">;
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
        ...(noCopiedMetricIsAdjusted ? ["regressionAdjustmentEnabled"] : []),
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
    "id" | "dateCreated" | "settings" | "metricRefresh"
  >,
  metricIds: string[],
): SnapshotMetricRefresh {
  const root = parent.metricRefresh
    ? {
        baseSnapshotId: parent.metricRefresh.baseSnapshotId,
        baseDateCreated: parent.metricRefresh.baseDateCreated,
        baseCutoffDate: parent.metricRefresh.baseCutoffDate ?? null,
      }
    : {
        baseSnapshotId: parent.id,
        baseDateCreated: parent.dateCreated,
        baseCutoffDate: getSnapshotCutoffDate(parent.settings),
      };
  return { ...root, parentSnapshotId: parent.id, metricIds };
}

export type IncrementalMetricRefreshRun = {
  definitionMetricIds: ReadonlySet<string>;
  scanEnd: Date;
};

export function parseIncrementalRefreshBase({
  state,
  parentSnapshotId,
  definitionMetricIds,
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
  definitionMetricIds: ReadonlySet<string>;
  scanEnd: Date;
}): IncrementalMetricRefreshRun {
  const sources = state?.metricSources ?? [];
  const pastScanEnd = (timestamp: Date | null) =>
    !!timestamp && timestamp > scanEnd;
  const tablesMatchParent =
    !!state?.unitsTableFullName &&
    state.materializedBySnapshotId === parentSnapshotId &&
    ![state.unitsMaxTimestamp, ...sources.map((s) => s.maxTimestamp)].some(
      pastScanEnd,
    );
  const storesTarget = sources.some((source) =>
    source.metrics.some((m) =>
      definitionMetricIds.has(getDefinitionMetricId(m.id)),
    ),
  );
  if (!tablesMatchParent || storesTarget) {
    throw unavailable("incremental_pipeline");
  }
  return { definitionMetricIds, scanEnd };
}

export async function resolveIncrementalMetricRefreshRun({
  context,
  snapshot,
  metricRefresh,
}: {
  context: ReqContext | ApiReqContext;
  snapshot: PlannedExperimentSnapshot["snapshot"];
  metricRefresh: SnapshotMetricRefresh;
}): Promise<IncrementalMetricRefreshRun> {
  if (snapshot.runnerKind !== "incremental-update") {
    throw unavailable("incremental_pipeline");
  }
  const scanEnd = getSnapshotCutoffDate(snapshot.settings);
  if (!scanEnd) {
    throw unavailable("phase_ended");
  }
  return parseIncrementalRefreshBase({
    state: await context.models.incrementalRefresh.getLockedBySnapshotId(
      snapshot.experiment,
      snapshot.id,
    ),
    parentSnapshotId: metricRefresh.parentSnapshotId,
    definitionMetricIds: new Set(metricRefresh.metricIds),
    scanEnd,
  });
}

export async function getMetricRefreshLockConflict(
  context: ReqContext | ApiReqContext,
  experimentId: string,
  phase: number,
): Promise<SnapshotInProgressError> {
  const state =
    await context.models.incrementalRefresh.getByExperimentIdAndPhase(
      experimentId,
      phase,
    );
  return new SnapshotInProgressError(state?.currentExecutionSnapshotId ?? "");
}

/**
 * Copies the parent's finished queries that `keep` selects into new query
 * documents under the same names.
 */
export async function carryMetricRefreshQueries(
  context: ReqContext | ApiReqContext,
  metricRefresh: SnapshotMetricRefresh,
  keep: (pointer: QueryPointer) => boolean,
): Promise<Queries> {
  const parentQueries = await getSnapshotQueryPointers(
    context,
    metricRefresh.parentSnapshotId,
  );
  if (!parentQueries) {
    throw new Error(
      `Could not load snapshot ${metricRefresh.parentSnapshotId} to copy its results`,
    );
  }
  const pointers = parentQueries.filter(keep);
  const docs = new Map(
    (
      await getQueriesByIds(
        context,
        pointers.map((p) => p.query),
        false,
      )
    ).map((doc) => [doc.id, doc]),
  );
  return Promise.all(
    pointers.map(async (pointer) => {
      const existing = docs.get(pointer.query);
      if (existing?.status !== "succeeded") {
        throw new Error(
          `Query "${pointer.name}" of snapshot ${metricRefresh.parentSnapshotId} is no longer available`,
        );
      }
      const copy = await createNewQueryFromCached({
        existing,
        dependencies: [],
        runAtEnd: false,
      });
      return { name: pointer.name, query: copy.id, status: copy.status };
    }),
  );
}
