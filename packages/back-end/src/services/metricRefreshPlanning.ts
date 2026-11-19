import isEqual from "lodash/isEqual";
import omitBy from "lodash/omitBy";
import {
  getDefinitionMetricId,
  getMetricIdsMissingFromSnapshot,
  getMetricRefresh,
  getSnapshotDataAsOf,
  isAnalysisDateRangeOutdated,
  isWithinNewMetricsUpdateWindow,
} from "shared/experiments";
import {
  getIdentifierTypeForSettingsHash,
  getSnapshotCutoffDate,
  isDefined,
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
  MetricForSnapshot,
  SnapshotMetricRefresh,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { QueryPointer } from "shared/types/query";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import {
  findLatestSuccessfulOverallSnapshot,
  findMetricRefreshAncestor,
  getLatestSnapshotStatus,
  type MetricRefreshAncestor,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  getIndexAfterLastGroup,
  isCarriedMetricRefreshQuery,
  type ResultQueryScope,
} from "back-end/src/queryRunners/metricRefreshQueryNaming";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricRefreshUnavailableReason,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

const UNAVAILABLE_MESSAGES: Record<MetricRefreshUnavailableReason, string> = {
  no_base_snapshot:
    'This experiment has no results to add metrics to yet. Send "updateScope": "all_metrics" to compute every metric.',
  not_latest_phase:
    "Only the current phase's results can be updated for newly added metrics.",
  phase_ended:
    'This phase has ended, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" instead.',
  unsupported_experiment_type:
    'Bandits and holdouts can\'t update newly added metrics on their own. Send "updateScope": "all_metrics" instead.',
  unsupported_data_source:
    'This Data Source analyzes every metric in one query, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" instead.',
  incremental_pipeline:
    'The experiment\'s Incremental Pipeline tables don\'t match its latest results, for example because a later update failed. Send "updateScope": "all_metrics" to fix this.',
  metric_not_supported:
    'The latest results ran on a different pipeline than this experiment\'s metrics need now, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" instead.',
  settings_changed:
    'The last update\'s results can\'t be reused for newly added metrics. Send "updateScope": "all_metrics" instead.',
  analysis_dates_changed:
    'The analysis dates changed by a day or more since the latest results, so newly added metrics would cover different dates than the other metrics. Send "updateScope": "all_metrics" instead.',
  base_incomplete:
    'The last update\'s results are incomplete, so they can\'t be reused. Send "updateScope": "all_metrics" instead.',
};

function unavailable(
  reason: MetricRefreshUnavailableReason,
  message: string = UNAVAILABLE_MESSAGES[reason],
): MetricRefreshUnavailableError {
  return new MetricRefreshUnavailableError(reason, message);
}

export type NewMetricsUpdateWindow = { windowHours: number; now: Date };

/**
 * Whether an update that didn't choose a scope should compute only the newly
 * added metrics: some are missing and the latest results end less than the
 * window before now. A window of 0 never applies.
 */
export function shouldUpdateNewMetricsOnly({
  missingMetricIds,
  resultsEndDate,
  now,
  windowHours,
}: NewMetricsUpdateWindow & {
  missingMetricIds: readonly string[];
  resultsEndDate: Date;
}): boolean {
  return (
    missingMetricIds.length > 0 &&
    isWithinNewMetricsUpdateWindow({ resultsEndDate, windowHours, now })
  );
}

/** The SQL of a dry run of the standard pipeline's result queries, by name. */
export type GenerateResultQuerySql = (args: {
  settings: ExperimentSnapshotSettings;
  queryParentId: string;
  scope?: ResultQueryScope;
}) => Promise<Map<string, string>>;

/**
 * Plans a snapshot that queries only the experiment's metrics missing from
 * the latest successful Overall snapshot (its parent) and copies the
 * parent's query results for every other metric, pinned to the parent's end
 * date. Throws a typed error before anything is written. With `window`, also
 * throws MetricRefreshOutsideWindowError when shouldUpdateNewMetricsOnly says no.
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
  if (
    window &&
    !shouldUpdateNewMetricsOnly({
      ...window,
      missingMetricIds,
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
    throw unavailable("analysis_dates_changed");
  }
  // A refresh extends the parent's default analysis.
  if (parent.analyses[0]?.status !== "success") {
    throw unavailable("base_incomplete");
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
        throw unavailable("settings_changed");
      }
      throw error;
    },
  );
  if (!getSnapshotCutoffDate(plan.snapshot.settings)) {
    throw unavailable("phase_ended");
  }
  assertRefreshablePipeline({ parent, plan });
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
  const snapshot = {
    ...plan.snapshot,
    settings,
    metricRefresh: getMetricRefreshLineage(parent, queriedMetricIds),
  };
  const carriedQueries = parent.queries.filter((q) =>
    isCarriedMetricRefreshQuery(q.name, snapshot, snapshot.metricRefresh),
  );
  if (carriedQueries.some((q) => q.status !== "succeeded")) {
    throw unavailable("base_incomplete");
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
    throw unavailable(
      "incremental_pipeline",
      'The Incremental Pipeline has no tables for this experiment\'s current settings yet, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" to build them.',
    );
  }
  throw plan.incrementalFallbackReason
    ? unavailable(
        "metric_not_supported",
        `The latest results ran on the Incremental Pipeline, which can't run this experiment now. ${plan.incrementalFallbackReason} Send "updateScope": "all_metrics" instead.`,
      )
    : unavailable("metric_not_supported");
}

// Each refresh adds a level, and each level costs a dry run of its queries.
const MAX_METRIC_REFRESH_LINEAGE_LENGTH = 10;

/** Base full update first, parent last, at most the cap. */
async function loadMetricRefreshLineage(
  context: ReqContext | ApiReqContext,
  parent: MetricRefreshAncestor,
): Promise<MetricRefreshAncestor[]> {
  const lineage = [parent];
  for (
    let metricRefresh = getMetricRefresh(parent);
    metricRefresh;
    metricRefresh = getMetricRefresh(lineage[0])
  ) {
    if (lineage.length >= MAX_METRIC_REFRESH_LINEAGE_LENGTH) {
      throw unavailable(
        "base_incomplete",
        `The latest results come from ${MAX_METRIC_REFRESH_LINEAGE_LENGTH - 1} updates of newly added metrics in a row, the most that can build on each other. Send "updateScope": "all_metrics" instead.`,
      );
    }
    const ancestor = await findMetricRefreshAncestor(
      context,
      metricRefresh.parentSnapshotId,
    );
    if (!ancestor) {
      throw unavailable(
        "base_incomplete",
        'An earlier update the latest results were built from no longer exists, so they can\'t be reused. Send "updateScope": "all_metrics" instead.',
      );
    }
    lineage.unshift(ancestor);
  }
  return lineage;
}

/**
 * One snapshot of a refresh lineage as it would run today: its stored metrics
 * in stored order with today's settings, and the metrics it queried itself
 * when it is a refresh.
 */
export type MetricRefreshReplayLevel = {
  snapshotId: string;
  metricSettings: MetricForSnapshot[];
  refreshedMetricIds: string[] | null;
  /**
   * Null for a run with a cutoff. A run without one read the clock when it
   * generated its SQL, at most this long after its end date.
   */
  maxSqlClockDriftMs: number | null;
};

/**
 * Today's SQL for a stored query. A run without a cutoff wrote the
 * skipPartialData exposure cutoff from its clock, so each such literal may be
 * up to `maxDriftMs` later than in `sqlAsOfEndDate`.
 */
export type ReplayedQuerySql = {
  sql: string;
  clockedExposureCutoffs: { sqlAsOfEndDate: string; maxDriftMs: number } | null;
};

/**
 * The SQL each level would run today, by query name. A refresh numbers its
 * own metric groups after the groups it copied, so the levels replay base
 * first to reproduce the stored grouping. Each level names its own units
 * table, and replays with or without a cutoff as it ran.
 */
export async function replayMetricRefreshLineage({
  levels,
  settings,
  generateResultQuerySql,
}: {
  levels: readonly MetricRefreshReplayLevel[];
  settings: ExperimentSnapshotSettings;
  generateResultQuerySql: GenerateResultQuerySql;
}): Promise<Map<string, ReplayedQuerySql>> {
  const sqlByName = new Map<string, ReplayedQuerySql>();
  for (const level of levels) {
    const scope = level.refreshedMetricIds
      ? {
          metricIds: new Set(level.refreshedMetricIds),
          firstGroupIndex: getIndexAfterLastGroup([...sqlByName.keys()]),
        }
      : undefined;
    const generate = (endDateIsCutoff: boolean) =>
      generateResultQuerySql({
        settings: {
          ...settings,
          metricSettings: level.metricSettings,
          endDateIsCutoff,
        },
        queryParentId: level.snapshotId,
        scope,
      });
    const driftMs = level.maxSqlClockDriftMs;
    const levelSql = await generate(driftMs === null);
    const asOfEndDate =
      driftMs !== null && settings.skipPartialData
        ? await generate(true)
        : null;
    levelSql.forEach((sql, name) =>
      sqlByName.set(name, {
        sql,
        clockedExposureCutoffs:
          asOfEndDate && driftMs !== null
            ? {
                sqlAsOfEndDate: asOfEndDate.get(name) ?? "",
                maxDriftMs: driftMs,
              }
            : null,
      }),
    );
  }
  return sqlByName;
}

// Comment lines carry metric and fact table names, which don't change results.
const withoutCommentLines = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

// The clause skipPartialData adds, in each dialect's timestamp literal.
const EXPOSURE_CUTOFF_CLAUSE =
  /\b(first_(?:exposure|activation)_timestamp <= \w*\(?')(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)Z?'/g;

function splitExposureCutoffs(sql: string): {
  sqlWithoutCutoffs: string;
  cutoffs: number[];
} {
  const cutoffs: number[] = [];
  const sqlWithoutCutoffs = sql.replace(
    EXPOSURE_CUTOFF_CLAUSE,
    (_, clause: string, utcTimestamp: string) => {
      cutoffs.push(Date.parse(`${utcTimestamp.replace(" ", "T")}Z`));
      return `${clause}'`;
    },
  );
  return { sqlWithoutCutoffs, cutoffs };
}

function isSqlUnchanged(stored: string, today: ReplayedQuerySql): boolean {
  const storedSql = withoutCommentLines(stored);
  const todaysSql = withoutCommentLines(today.sql);
  const clocked = today.clockedExposureCutoffs;
  if (!clocked) return storedSql === todaysSql;

  const storedParts = splitExposureCutoffs(storedSql);
  const earliest = splitExposureCutoffs(
    withoutCommentLines(clocked.sqlAsOfEndDate),
  ).cutoffs;
  return (
    storedParts.sqlWithoutCutoffs ===
      splitExposureCutoffs(todaysSql).sqlWithoutCutoffs &&
    storedParts.cutoffs.length === earliest.length &&
    storedParts.cutoffs.every((cutoff, i) => {
      const drift = cutoff - earliest[i];
      // Some dialects write whole seconds.
      return drift >= 0 && drift < clocked.maxDriftMs + 1000;
    })
  );
}

/** The named queries whose stored SQL is missing or differs from today's. */
export function getQueriesWithChangedSql({
  queryNames,
  storedSql,
  todaysSql,
}: {
  queryNames: readonly string[];
  storedSql: ReadonlyMap<string, string>;
  todaysSql: ReadonlyMap<string, ReplayedQuerySql>;
}): string[] {
  return queryNames.filter((name) => {
    const stored = storedSql.get(name);
    const today = todaysSql.get(name);
    return (
      stored === undefined ||
      today === undefined ||
      !isSqlUnchanged(stored, today)
    );
  });
}

/**
 * Refuses unless every query the refresh would copy from a results parent,
 * and every units table those queries read, would be generated with the same
 * SQL today. This catches changed metric definitions, exposure and segment
 * SQL, identity joins, and releases that change how SQL is generated.
 */
async function assertCarriedQuerySqlUnchanged({
  context,
  parent,
  planned,
  carriedQueries,
  generateResultQuerySql,
}: {
  context: ReqContext | ApiReqContext;
  parent: ExperimentSnapshotInterface;
  planned: ExperimentSnapshotSettings;
  carriedQueries: QueryPointer[];
  generateResultQuerySql: GenerateResultQuerySql;
}): Promise<void> {
  const lineage = await loadMetricRefreshLineage(context, parent);

  const todaysEntries = new Map(planned.metricSettings.map((m) => [m.id, m]));
  const levels = lineage.map((level): MetricRefreshReplayLevel => {
    const metricSettings = level.settings.metricSettings.map((m) =>
      todaysEntries.get(m.id),
    );
    // A metric no longer on the experiment has no settings to regenerate its
    // group from, so the group can't be checked.
    if (!metricSettings.every(isDefined)) {
      throw unavailable("settings_changed");
    }
    return {
      snapshotId: level.id,
      metricSettings,
      refreshedMetricIds: getMetricRefresh(level)?.metricIds ?? null,
      maxSqlClockDriftMs: getSnapshotCutoffDate(level.settings)
        ? null
        : Math.max(
            0,
            (level.runStarted ?? level.settings.endDate).getTime() -
              level.settings.endDate.getTime(),
          ),
    };
  });

  // In pipeline mode, exposure and segment SQL live in each level's units table query.
  const unitsQueries = lineage.flatMap((level) =>
    level.queries.filter((q) => q.name === level.id),
  );
  const comparedQueries = [...carriedQueries, ...unitsQueries];
  const sqlById = new Map(
    (
      await getQueriesByIds(
        context,
        comparedQueries.map((q) => q.query),
        false,
      )
    ).map((doc) => [doc.id, doc.query]),
  );
  const storedSql = new Map(
    comparedQueries.flatMap((q): [string, string][] => {
      const sql = sqlById.get(q.query);
      return sql === undefined ? [] : [[q.name, sql]];
    }),
  );

  const todaysSql = await replayMetricRefreshLineage({
    levels,
    settings: planned,
    generateResultQuerySql,
  }).catch((error: unknown) => {
    // A normal update reports the error itself if it is real.
    context.logger.warn(
      error,
      "Could not regenerate the SQL a metric refresh would copy",
    );
    throw unavailable("settings_changed");
  });
  const changed = getQueriesWithChangedSql({
    queryNames: comparedQueries.map((q) => q.name),
    storedSql,
    todaysSql,
  });
  if (changed.length) {
    throw unavailable("settings_changed");
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
        baseRunStarted: parent.metricRefresh.baseRunStarted ?? null,
        baseCutoffDate: parent.metricRefresh.baseCutoffDate ?? null,
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
    throw unavailable("incremental_pipeline");
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
