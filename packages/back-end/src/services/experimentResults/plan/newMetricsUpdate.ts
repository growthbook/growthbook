import isEqual from "lodash/isEqual";
import omitBy from "lodash/omitBy";
import {
  getDefinitionMetricId,
  getMetricIdsMissingFromSnapshot,
  getNewMetricsUpdate,
  getNewMetricsUpdateParentRefusal,
  getNewMetricsUpdatePlanRefusal,
  getNewMetricsUpdateSetupBlocker,
  getNewMetricsUpdatesInARow,
  getResultsOutdatedReasons,
  isFactMetric,
  type ExperimentMetricInterface,
  type NewMetricsUpdateRefusal,
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
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getQueryableMetricsFromSnapshotSettings } from "back-end/src/services/experimentQueries/experimentQueries";
import { getMetricSettingsHashesForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { isCarriedNewMetricsUpdateQuery } from "back-end/src/queryRunners/experimentQueryNaming";
import {
  assertCarriedQuerySqlUnchanged,
  tooManyNewMetricsUpdatesError,
  type GenerateResultQuerySql,
} from "back-end/src/services/experimentResults/plan/newMetricsUpdateSqlIdentity";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  NewMetricsUpdateUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

/**
 * Plans a snapshot that queries only the experiment's metrics missing from
 * the latest successful Overall snapshot (its parent) and copies the
 * parent's query results for every other metric, pinned to the parent's end
 * date. Throws a typed error before anything is written.
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
  metricMap,
  factTableMap,
  planSnapshotAt,
  generateResultQuerySql,
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
  // Today's definitions, including the derived metrics planning expands.
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  planSnapshotAt: (cutoff: Date) => Promise<PlannedExperimentSnapshot>;
  generateResultQuerySql: GenerateResultQuerySql;
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
  // Checked once there are metrics to add: a request with none falls back to
  // a normal update, which decides on its own what a running update means.
  const latest = await getLatestSnapshotStatus({
    context,
    experiment: experiment.id,
    phase,
    type: "standard",
  });
  if (latest?.status === "running") {
    throw new SnapshotInProgressError(latest.id);
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
  const parentRefusal = getNewMetricsUpdateParentRefusal({
    ...blockerArgs,
    outdatedReasons,
  });
  if (parentRefusal) {
    throw new NewMetricsUpdateUnavailableError(parentRefusal);
  }
  // A new-metrics update extends the parent's default analysis.
  if (parent.analyses[0]?.status !== "success") {
    throw new NewMetricsUpdateUnavailableError("base_incomplete");
  }

  const onIncrementalPipeline = (parent.runnerKind ?? "results") !== "results";
  const incrementalState = onIncrementalPipeline
    ? await context.models.incrementalRefresh.getByExperimentIdAndPhase(
        experiment.id,
        phase,
      )
    : null;
  if (onIncrementalPipeline) {
    assertIncrementalTablesMatchParent({
      state: incrementalState,
      parentSnapshotId: parent.id,
    });
  }
  // Planned as of the parent's end. The pipeline's own validation refuses a
  // plan whose tables hold rows past it, such as rows a failed run appended.
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
  const planRefusal = getNewMetricsUpdatePlanRefusal({
    parent,
    outdatedReasons,
    planned: {
      runnerKind: plan.snapshot.runnerKind ?? "results",
      settings: plan.snapshot.settings,
    },
  });
  if (planRefusal) {
    throw getPlanRefusalError(planRefusal, plan);
  }
  if (getChangedCopiedResultsSettings(parent, plan.snapshot.settings).length) {
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
  const queried = new Set(queriedMetricIds);
  const snapshot = {
    ...plan.snapshot,
    settings,
    updateScope: getNewMetricsUpdateLineage(parent, queriedMetricIds),
  };
  const carriedQueries = parent.queries.filter((q) =>
    isCarriedNewMetricsUpdateQuery(q.name, snapshot, snapshot.updateScope),
  );
  if (carriedQueries.some((q) => q.status !== "succeeded")) {
    throw new NewMetricsUpdateUnavailableError("base_incomplete");
  }
  // The Incremental Pipeline's carried SQL only reads its cache tables, so
  // identical text there would prove nothing about the metrics behind them;
  // the settings hash stored for each cached metric does.
  if (onIncrementalPipeline) {
    // The runner copies each carried query from its document, which can be
    // gone while the parent still points at it. The Results pipeline loads the
    // same documents to compare their SQL.
    const carriedDocs = new Map(
      (
        await getQueriesByIds(
          context,
          carriedQueries.map((q) => q.query),
          false,
        )
      ).map((doc) => [doc.id, doc.status]),
    );
    if (carriedQueries.some((q) => carriedDocs.get(q.query) !== "succeeded")) {
      throw new NewMetricsUpdateUnavailableError("base_incomplete");
    }
    assertCopiedMetricCachesUnchanged({
      metricSources: incrementalState?.metricSources ?? [],
      copiedMetricIds: new Set(
        settings.metricSettings
          .map((m) => m.id)
          .filter((id) => !queried.has(id)),
      ),
      todaysSettingsHashes: getMetricSettingsHashesForIncrementalRefresh({
        factMetrics: getQueryableMetricsFromSnapshotSettings(
          plan.snapshot.settings,
          metricMap,
        ).filter(isFactMetric),
        factTableMap,
        snapshotSettings: plan.snapshot.settings,
      }),
    });
  } else {
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

// What the back end says beyond the shared rules' reasons: why the planned run
// is on another pipeline, and the cap on updates in a row.
function getPlanRefusalError(
  refusal: Exclude<NewMetricsUpdateRefusal, "outside_window">,
  plan: Pick<PlannedExperimentSnapshot, "incrementalFallbackReason">,
): NewMetricsUpdateUnavailableError {
  if (refusal === "incremental_pipeline") {
    return new NewMetricsUpdateUnavailableError(
      "incremental_pipeline",
      'The Incremental Pipeline has no tables for this experiment\'s current settings yet, so newly added metrics can\'t be updated on their own. Send "updateScope": "all_metrics" to build them.',
    );
  }
  if (refusal === "base_incomplete") return tooManyNewMetricsUpdatesError();
  if (refusal === "metric_not_supported" && plan.incrementalFallbackReason) {
    return new NewMetricsUpdateUnavailableError(
      "metric_not_supported",
      `The latest results ran on the Incremental Pipeline, which can't run this experiment now. ${plan.incrementalFallbackReason} Send "updateScope": "all_metrics" instead.`,
    );
  }
  return new NewMetricsUpdateUnavailableError(refusal);
}

/**
 * What a change to each snapshot setting between the parent and the planned
 * full update does to a new-metrics update, whose copied results keep the
 * parent's queries and analysis. A setting added without a rule fails to
 * compile, and one stored without a rule refuses.
 */
type CopiedResultsSettingRule =
  | "refuses"
  // Only result query SQL reads it. A Results parent's update regenerates and
  // compares that SQL; the Incremental Pipeline's carried SQL only reads its
  // tables, so a change refuses there.
  | "refuses_off_results_pipeline"
  | { ignoredBecause: string };

const OUTDATED_REASON_REFUSES =
  "an Outdated reason refuses on a change, reading a value the parent never stored as the default";

export const COPIED_RESULTS_SETTING_RULES: Record<
  keyof ExperimentSnapshotSettings,
  CopiedResultsSettingRule
> = {
  // The same SQL can run against another Data Source.
  datasourceId: "refuses",
  defaultMetricPriorSettings: {
    ignoredBecause:
      "the stats engine reads only each metric's prior resolved from it, its definition and the experiment, and a copied metric's resolved prior is a stats engine input that is compared",
  },
  // The badge compares variation keys; the SRM check reads their weights.
  variations: "refuses",
  coverage: "refuses",
  // The tracking key the queries filter on.
  experimentId: "refuses",
  // The badge tolerates a day of drift; the queries start at this exact time.
  startDate: "refuses",
  // Pinned to the parent's: a change means the pin broke.
  endDate: "refuses",
  // The parent is of the same phase.
  phase: "refuses",
  // Each also has an Outdated reason that refuses with the same reading of
  // empty values.
  activationMetric: "refuses",
  queryFilter: "refuses",
  segment: "refuses",
  skipPartialData: "refuses",
  exposureQueryId: "refuses",
  isClusterExperiment: "refuses",
  clusterSubUnitIdentifier: "refuses",
  // Only Bandits have it, which the setup blocker refuses.
  banditSettings: "refuses",
  // A manual snapshot's results came from no query.
  manual: "refuses",
  customFields: "refuses_off_results_pipeline",
  dimensions: "refuses_off_results_pipeline",
  lookbackOverride: "refuses_off_results_pipeline",
  precomputedUnitDimensionIds: "refuses_off_results_pipeline",
  attributionModel: { ignoredBecause: OUTDATED_REASON_REFUSES },
  exposureQueryIdentifierType: { ignoredBecause: OUTDATED_REASON_REFUSES },
  regressionAdjustmentEnabled: {
    ignoredBecause:
      "the CUPED Outdated reason refuses unless every copied metric opts out of CUPED, which then changes no copied number",
  },
  metricSettings: {
    ignoredBecause:
      "copied metrics keep the parent's entries, and their SQL or cache settings hashes and stats engine inputs are compared",
  },
  clusterLevelMetricIds: {
    ignoredBecause:
      "copied metrics keep the parent's levels, and a level is in its metric's SQL and cache settings hash",
  },
  goalMetrics: {
    ignoredBecause:
      "added metrics are the point, and a copied metric's role is a stats engine input that is compared",
  },
  secondaryMetrics: {
    ignoredBecause:
      "added metrics are the point, and a copied metric's role is a stats engine input that is compared",
  },
  guardrailMetrics: {
    ignoredBecause:
      "added metrics are the point, and a copied metric's role is a stats engine input that is compared",
  },
  endDateIsCutoff: {
    ignoredBecause:
      "the update is planned with the parent's end date as its cutoff, and the SQL comparison replays each run with its own flag",
  },
  plannedAt: {
    ignoredBecause:
      "it is the planning clock, and the SQL comparison replays each run with its own",
  },
};

const isEmptySetting = (value: unknown): boolean =>
  value === null ||
  value === false ||
  value === "" ||
  (typeof value === "object" && !Object.keys(value).length);

const hasSettingRule = (
  key: string,
): key is keyof typeof COPIED_RESULTS_SETTING_RULES =>
  Object.prototype.hasOwnProperty.call(COPIED_RESULTS_SETTING_RULES, key);

/**
 * The settings whose change makes copied results differ from a normal
 * update's. A setting one side lacks counts as that setting left empty.
 */
export function getChangedCopiedResultsSettings(
  parent: Pick<ExperimentSnapshotInterface, "settings" | "runnerKind">,
  planned: ExperimentSnapshotSettings,
): string[] {
  const comparable = (settings: ExperimentSnapshotSettings) =>
    omitBy(JSON.parse(JSON.stringify(settings)), isEmptySetting);
  const before = comparable(parent.settings);
  const after = comparable(planned);
  const onResultsPipeline = (parent.runnerKind ?? "results") === "results";
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => {
      if (isEqual(before[key], after[key])) return false;
      if (!hasSettingRule(key)) return true;
      const rule = COPIED_RESULTS_SETTING_RULES[key];
      return (
        rule === "refuses" ||
        (rule === "refuses_off_results_pipeline" && !onResultsPipeline)
      );
    },
  );
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
    "id" | "type" | "dateCreated" | "runStarted" | "settings" | "updateScope"
  >,
  queriedMetricIds: string[],
): SnapshotNewMetricsUpdate {
  return {
    kind: "new_metrics",
    parentSnapshotId: parent.id,
    queriedMetricIds,
    updatesInARow: getNewMetricsUpdatesInARow(parent) + 1,
    base: getNewMetricsUpdate(parent)?.base ?? {
      dateCreated: parent.dateCreated,
      runStarted: parent.runStarted,
      cutoffDate: getSnapshotCutoffDate(parent.settings),
    },
  };
}

/**
 * Accepts the pipeline state only when the parent is the last run that
 * succeeded on its tables.
 */
export function assertIncrementalTablesMatchParent({
  state,
  parentSnapshotId,
}: {
  state: Pick<
    IncrementalRefreshInterface,
    "unitsTableFullName" | "materializedBySnapshotId"
  > | null;
  parentSnapshotId: string;
}): void {
  const tablesMatchParent =
    !!state?.unitsTableFullName &&
    state.materializedBySnapshotId === parentSnapshotId;
  if (!tablesMatchParent) {
    throw new NewMetricsUpdateUnavailableError("incremental_pipeline");
  }
}

/**
 * Refuses when a copied metric's cache was built with settings other than
 * today's, such as before its definition was edited. Its copied results came
 * from that cache, which a normal update would rebuild.
 */
function assertCopiedMetricCachesUnchanged({
  metricSources,
  copiedMetricIds,
  todaysSettingsHashes,
}: {
  metricSources: IncrementalRefreshInterface["metricSources"];
  copiedMetricIds: ReadonlySet<string>;
  todaysSettingsHashes: ReadonlyMap<string, string>;
}): void {
  const changed = metricSources.some((source) =>
    source.metrics.some((m) => {
      const todaysHash = todaysSettingsHashes.get(m.id);
      return (
        copiedMetricIds.has(m.id) &&
        todaysHash !== undefined &&
        todaysHash !== m.settingsHash
      );
    }),
  );
  if (changed) {
    throw new NewMetricsUpdateUnavailableError("settings_changed");
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
  });
}
