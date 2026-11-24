import isEqual from "lodash/isEqual";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "shared/constants";
import { getValidDate } from "shared/dates";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotNewMetricsUpdate,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { DataSourceSettings } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import type { OrganizationSettings } from "shared/types/organization";
import type { newMetricsUpdateUnavailableReasons } from "../validators/api-errors";
import {
  type ExperimentMetricDefinition,
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getClusterExperimentMetricEligibility,
  getDefinitionMetricId,
  getMetricSnapshotSettings,
  isFactMetric,
  isFactMetricJoinable,
  isMetricJoinable,
} from "./experiments";
import type { ResultsOutdatedReason } from "./outdated-reasons";
import {
  type BusinessMetricLists,
  getMetricStatsEngineInputs,
} from "./results/stats-engine-inputs";

/**
 * The experiment's metrics that a snapshot holds no results for, in the
 * experiment's goal, secondary, guardrail order. Metric groups are expanded;
 * slice and funnel-step ids are left out, and so is the activation metric
 * unless it is also a goal, secondary or guardrail metric.
 */
export function getMetricIdsMissingFromSnapshot({
  experiment,
  snapshotSettings,
  metricGroups,
}: {
  experiment: Pick<
    ExperimentInterface,
    "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
  >;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricSettings">;
  metricGroups: MetricGroupInterface[];
}): string[] {
  const computed = new Set(snapshotSettings.metricSettings.map((m) => m.id));
  return getAllMetricIdsFromExperiment(experiment, false, metricGroups).filter(
    (id) => !computed.has(id) && getDefinitionMetricId(id) === id,
  );
}

/**
 * The experiment's metrics missing from a snapshot that a new-metrics update
 * would compute. Mirrors the metrics the back-end snapshot planner gives a
 * `metricSettings` entry: the metric must load, join the experiment's units
 * (for a cluster experiment, be cluster-eligible), and for a holdout be a goal
 * or secondary metric without a conversion window.
 */
export function getComputableNewMetricIds({
  experiment,
  snapshotSettings,
  metricGroups,
  getMetricById,
  getFactTableById,
  identifierType,
  datasourceSettings,
}: {
  experiment: Pick<
    ExperimentInterface,
    | "type"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "isClusterExperiment"
    | "clusterSubUnitIdentifier"
  >;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricSettings">;
  metricGroups: MetricGroupInterface[];
  getMetricById: (id: string) => ExperimentMetricDefinition | null | undefined;
  getFactTableById: (
    id: string,
  ) => Pick<FactTableInterface, "userIdTypes"> | null | undefined;
  identifierType: string | undefined;
  // Undefined while the Data Source is unknown, which lets every metric join.
  datasourceSettings: DataSourceSettings | undefined;
}): string[] {
  const holdoutAnalyzed =
    experiment.type === "holdout"
      ? new Set(
          expandMetricGroups(
            [...experiment.goalMetrics, ...experiment.secondaryMetrics],
            metricGroups,
          ),
        )
      : null;
  const clusterSubUnitIdentifier = experiment.isClusterExperiment
    ? experiment.clusterSubUnitIdentifier
    : undefined;

  return getMetricIdsMissingFromSnapshot({
    experiment,
    snapshotSettings,
    metricGroups,
  }).filter((id) => {
    const metric = getMetricById(id);
    if (!metric) return false;
    if (
      holdoutAnalyzed &&
      (!holdoutAnalyzed.has(id) || metric.windowSettings?.type === "conversion")
    ) {
      return false;
    }
    if (clusterSubUnitIdentifier) {
      return getClusterExperimentMetricEligibility(metric, {
        clusterIdentifier: identifierType,
        clusterSubUnitIdentifier,
        getFactTable: getFactTableById,
        datasourceSettings,
      }).allowed;
    }
    if (!identifierType || !datasourceSettings) return true;
    return isFactMetric(metric)
      ? isFactMetricJoinable(
          metric,
          identifierType,
          getFactTableById,
          datasourceSettings,
        )
      : isMetricJoinable(
          metric.userIdTypes ?? [],
          identifierType,
          datasourceSettings,
        );
  });
}

type SnapshotLineage = Pick<
  ExperimentSnapshotInterface,
  "type" | "dateCreated" | "updateScope"
>;

export function getNewMetricsUpdate(
  snapshot: Pick<ExperimentSnapshotInterface, "type" | "updateScope">,
): SnapshotNewMetricsUpdate | null {
  return snapshot.type === "standard" &&
    snapshot.updateScope?.kind === "new_metrics"
    ? snapshot.updateScope
    : null;
}

// On the standard pipeline each new-metrics update dry-runs the queries of
// every update in its chain. The full update the chain starts from is not
// counted.
export const MAX_NEW_METRICS_UPDATES_IN_A_ROW = 10;

/**
 * How many new-metrics updates in a row end with this snapshot. One stored
 * before the count was counts as 1, so on a chain started before then the
 * back end, which also walks the chain, can refuse an update this allows.
 */
export function getNewMetricsUpdatesInARow(
  snapshot: Pick<ExperimentSnapshotInterface, "type" | "updateScope">,
): number {
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  return newMetricsUpdate ? (newMetricsUpdate.updatesInARow ?? 1) : 0;
}

export function getSnapshotDataAsOfDate(snapshot: SnapshotLineage): Date {
  return (
    getNewMetricsUpdate(snapshot)?.base.dateCreated ?? snapshot.dateCreated
  );
}

/**
 * The results endpoint's `dateEnd`. A new-metrics update reports what its base
 * reported, so adding metrics never moves it.
 */
export function getResultsDateEnd(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "type" | "updateScope" | "runStarted"
  >,
  phase: { dateEnded?: Date | null } | undefined,
): Date | null {
  if (phase?.dateEnded) return phase.dateEnded;
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  return (
    (newMetricsUpdate
      ? newMetricsUpdate.base.runStarted
      : snapshot.runStarted) ?? null
  );
}

/**
 * Side effects that differ between a full run and a new-metrics update. Callers
 * keep their own conditions and also require the flag.
 */
export function getSnapshotSideEffects(snapshot: SnapshotLineage) {
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  if (!newMetricsUpdate) {
    return {
      advanceUpdateSchedule: true,
      refreshDashboards: true,
      ownsUpdateFailedAlert: true,
      timeSeries: {
        includesMetric: (): boolean => true,
        pointDate: snapshot.dateCreated,
      },
    };
  }
  const newMetricIds = new Set(newMetricsUpdate.queriedMetricIds);
  return {
    advanceUpdateSchedule: false,
    refreshDashboards: false,
    ownsUpdateFailedAlert: false,
    timeSeries: {
      includesMetric: (metricId: string): boolean =>
        newMetricIds.has(getDefinitionMetricId(metricId)),
      pointDate: newMetricsUpdate.base.dateCreated,
    },
  };
}

/**
 * Why an update can't compute only the newly added metrics. The rule is split
 * in the stages the back end can check them in: the window before it loads
 * anything, the parent before it plans, and the plan. The app checks all three
 * at once with getNewMetricsUpdateRefusal.
 */
export type NewMetricsUpdateRefusal =
  | Extract<
      (typeof newMetricsUpdateUnavailableReasons)[number],
      | "unsupported_experiment_type"
      | "not_latest_phase"
      | "phase_ended"
      | "unsupported_data_source"
      | "analysis_dates_changed"
      | "incremental_pipeline"
      | "metric_not_supported"
      | "settings_changed"
      | "base_incomplete"
    >
  | "outside_window";

type NewMetricsUpdateSetupFacts = {
  experiment: Pick<ExperimentInterface, "type"> & {
    phases: { dateEnded?: string | Date }[];
  };
  phase: number;
  separateExperimentResultQueries: boolean;
};

/**
 * What the experiment and its Data Source alone rule out, before any results
 * are read.
 */
export function getNewMetricsUpdateSetupBlocker({
  experiment,
  phase,
  separateExperimentResultQueries,
}: NewMetricsUpdateSetupFacts): Exclude<
  NewMetricsUpdateRefusal,
  "outside_window"
> | null {
  if ((experiment.type ?? "standard") !== "standard") {
    return "unsupported_experiment_type";
  }
  if (phase !== experiment.phases.length - 1) return "not_latest_phase";
  if (!separateExperimentResultQueries) return "unsupported_data_source";
  return null;
}

const HOUR_MS = 60 * 60 * 1000;

export type NewMetricsUpdateWindow = { windowHours: number; now: Date };

/**
 * Whether results ending at `resultsEndDate`, the parent's end date, are
 * recent enough. A window of 0 hours turns the new-metrics update off.
 */
export function isWithinNewMetricsUpdateWindow({
  resultsEndDate,
  windowHours,
  now,
}: NewMetricsUpdateWindow & { resultsEndDate: Date }): boolean {
  return (
    windowHours > 0 &&
    now.getTime() - resultsEndDate.getTime() < windowHours * HOUR_MS
  );
}

type NewMetricsUpdateParentFacts = NewMetricsUpdateSetupFacts & {
  // getResultsOutdatedReasons against the parent.
  outdatedReasons: readonly ResultsOutdatedReason[];
};

/** What the parent rules out before an update is planned against it. */
export function getNewMetricsUpdateParentRefusal({
  outdatedReasons,
  ...setup
}: NewMetricsUpdateParentFacts): Exclude<
  NewMetricsUpdateRefusal,
  "outside_window"
> | null {
  const setupBlocker = getNewMetricsUpdateSetupBlocker(setup);
  if (setupBlocker) return setupBlocker;
  if (setup.experiment.phases[setup.phase]?.dateEnded) return "phase_ended";
  if (outdatedReasons.includes("analysis_dates_changed")) {
    return "analysis_dates_changed";
  }
  return null;
}

type PlannedMetricSettings = {
  id: string;
  computedSettings?: Pick<
    NonNullable<MetricForSnapshot["computedSettings"]>,
    | "regressionAdjustmentEnabled"
    | "properPrior"
    | "properPriorMean"
    | "properPriorStdDev"
    | "targetMDE"
  >;
};

type ParentMetricSettings = BusinessMetricLists & {
  metricSettings: readonly PlannedMetricSettings[];
};

/**
 * What a full update planned now would run and store for the metrics the
 * parent computed. The back end passes its plan; the app predicts it with
 * getPlannedCopiedMetricSettings.
 */
type NewMetricsUpdateParent = Pick<
  ExperimentSnapshotInterface,
  "type" | "updateScope" | "runnerKind"
> & {
  settings: ParentMetricSettings;
  analyses: {
    settings: Pick<ExperimentSnapshotAnalysisSettings, "pValueCorrection">;
  }[];
};

export type PlannedNewMetricsUpdate = {
  runnerKind: SnapshotQueryRunnerKind;
  settings: ParentMetricSettings;
};

const optsOutOfCuped = (m: PlannedMetricSettings) =>
  m.computedSettings?.regressionAdjustmentEnabled === false;

/**
 * What the plan rules out. A new-metrics update appends to its parent's
 * pipeline, on the Incremental Pipeline to the tables the parent left, which
 * an "incremental-full" run would rebuild. On the standard pipeline at most
 * MAX_NEW_METRICS_UPDATES_IN_A_ROW build on each other. Copied metrics keep
 * the parent's results and analysis, so only the metric lists may be
 * outdated, and the inputs only the stats engine reads must be unchanged.
 */
export function getNewMetricsUpdatePlanRefusal({
  parent,
  outdatedReasons,
  planned,
}: {
  parent: NewMetricsUpdateParent;
  outdatedReasons: readonly ResultsOutdatedReason[];
  planned: PlannedNewMetricsUpdate;
}): Exclude<NewMetricsUpdateRefusal, "outside_window"> | null {
  const parentPipeline =
    (parent.runnerKind ?? "results") === "results"
      ? "results"
      : "incremental-update";
  if (planned.runnerKind !== parentPipeline) {
    return planned.runnerKind === "incremental-full"
      ? "incremental_pipeline"
      : "metric_not_supported";
  }
  if (
    parentPipeline === "results" &&
    getNewMetricsUpdatesInARow(parent) >= MAX_NEW_METRICS_UPDATES_IN_A_ROW
  ) {
    return "base_incomplete";
  }

  const parentMetricIds = new Set(
    parent.settings.metricSettings.map((m) => m.id),
  );
  const copied = planned.settings.metricSettings.filter((m) =>
    parentMetricIds.has(m.id),
  );
  // The scheduled job stores CUPED as off when the experiment adjusts but
  // every metric opts out, and the badge then reports a CUPED change. A metric
  // is only adjusted when its own flag is on, so that reason changes no copied
  // number while every copied metric opts out.
  const cupedChangesNoCopiedMetric =
    parent.settings.metricSettings.every(optsOutOfCuped) &&
    copied.every(optsOutOfCuped);
  if (
    outdatedReasons.some(
      (reason) =>
        reason !== "metrics_changed" &&
        // A goal metric was added or removed, and the update corrects the
        // goal metrics it ends with together. A copied metric that changed
        // role is refused below.
        reason !== "goal_metrics_changed" &&
        !(reason === "cuped" && cupedChangesNoCopiedMetric),
    )
  ) {
    return "settings_changed";
  }

  if (
    haveStatsEngineInputsChanged({
      parent: parent.settings,
      planned: planned.settings,
      metricIds: copied.map((m) => m.id),
    })
  ) {
    return "settings_changed";
  }

  // An analysis that recorded no correction method, not even null, was saved
  // before methods were stored. Its corrected p-values are only computed when
  // it is read, and its results hold values the stats engine then derived
  // from the goal and guardrail counts, so they can't be extended. The field
  // stands in for the stats engine's version, which changed one commit later.
  if (parent.analyses[0]?.settings.pValueCorrection === undefined) {
    return "settings_changed";
  }
  return null;
}

/**
 * Why Update can't compute only the newly added metrics on top of `parent`,
 * the phase's latest successful Overall Results, or null when it can. `window`
 * is null when the caller applies none.
 */
export function getNewMetricsUpdateRefusal({
  parent,
  window,
  planned,
  ...facts
}: NewMetricsUpdateParentFacts & {
  parent: NewMetricsUpdateParent & {
    settings: Pick<ExperimentSnapshotSettings, "endDate">;
  };
  window: NewMetricsUpdateWindow | null;
  planned: PlannedNewMetricsUpdate;
}): NewMetricsUpdateRefusal | null {
  if (
    window &&
    !isWithinNewMetricsUpdateWindow({
      ...window,
      resultsEndDate: getValidDate(parent.settings.endDate),
    })
  ) {
    return "outside_window";
  }
  return (
    getNewMetricsUpdateParentRefusal(facts) ??
    getNewMetricsUpdatePlanRefusal({
      parent,
      outdatedReasons: facts.outdatedReasons,
      planned,
    })
  );
}

/**
 * What a full update planned now would store for the parent's metrics still on
 * the experiment, from today's definitions, for the app to pass as
 * getNewMetricsUpdateRefusal's `planned` settings. A metric whose definition
 * `getMetricById` can't resolve gets no computed settings, so it counts as
 * changed.
 */
export function getPlannedCopiedMetricSettings({
  parentSettings,
  experiment,
  metricGroups,
  organizationSettings,
  getMetricById,
}: {
  parentSettings: Pick<ExperimentSnapshotSettings, "metricSettings">;
  experiment: Pick<
    ExperimentInterface,
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "activationMetric"
    | "metricOverrides"
    | "decisionFrameworkSettings"
    | "regressionAdjustmentEnabled"
  >;
  metricGroups: MetricGroupInterface[];
  organizationSettings: Partial<OrganizationSettings>;
  getMetricById: (id: string) => ExperimentMetricDefinition | null | undefined;
}): PlannedNewMetricsUpdate["settings"] {
  const businessMetrics = {
    goalMetrics: expandMetricGroups(experiment.goalMetrics, metricGroups),
    secondaryMetrics: expandMetricGroups(
      experiment.secondaryMetrics,
      metricGroups,
    ),
    guardrailMetrics: expandMetricGroups(
      experiment.guardrailMetrics,
      metricGroups,
    ),
  };
  const experimentMetricIds = new Set(
    getAllMetricIdsFromExperiment(experiment, true, metricGroups),
  );
  // The planner computes settings only for these; the activation metric gets
  // its defaults.
  const settingsMetricIds = new Set(
    getAllMetricIdsFromExperiment(experiment, false, metricGroups),
  );
  const metricSettings: PlannedMetricSettings[] = [];
  for (const { id } of parentSettings.metricSettings) {
    const definitionMetricId = getDefinitionMetricId(id);
    if (!experimentMetricIds.has(definitionMetricId)) continue;
    const metric = getMetricById(definitionMetricId);
    if (!metric) {
      metricSettings.push({ id });
      continue;
    }
    // The planner passes every loaded denominator; only a legacy ratio
    // metric's own denominator changes its result.
    const denominator =
      !isFactMetric(metric) && metric.denominator
        ? getMetricById(metric.denominator)
        : null;
    const metricSnapshotSettings = settingsMetricIds.has(definitionMetricId)
      ? getMetricSnapshotSettings({
          metric,
          denominatorMetrics:
            denominator && !isFactMetric(denominator) ? [denominator] : [],
          experimentRegressionAdjustmentEnabled:
            experiment.regressionAdjustmentEnabled ??
            DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
          organizationSettings,
          metricOverrides: experiment.metricOverrides,
        }).metricSnapshotSettings
      : {
          regressionAdjustmentEnabled: false,
          properPrior: false,
          properPriorMean: 0,
          properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
        };
    metricSettings.push({
      id,
      computedSettings: {
        regressionAdjustmentEnabled:
          metricSnapshotSettings.regressionAdjustmentEnabled,
        properPrior: metricSnapshotSettings.properPrior,
        properPriorMean: metricSnapshotSettings.properPriorMean,
        properPriorStdDev: metricSnapshotSettings.properPriorStdDev,
        targetMDE:
          experiment.decisionFrameworkSettings?.decisionFrameworkMetricOverrides?.find(
            (o) => o.id === definitionMetricId,
          )?.targetMDE ?? metric.targetMDE,
      },
    });
  }
  return { ...businessMetrics, metricSettings };
}

// Null when the settings have no computed settings for the metric.
function getStoredStatsEngineInputs(
  settings: ParentMetricSettings,
  metricId: string,
) {
  const computed = settings.metricSettings.find(
    (m) => m.id === metricId,
  )?.computedSettings;
  return computed
    ? getMetricStatsEngineInputs(metricId, computed, settings)
    : null;
}

/**
 * Whether the stats engine would read any of these metrics differently than it
 * did for the parent, so their copied results would be stale. A metric either
 * side stored no computed settings for counts as changed.
 */
export function haveStatsEngineInputsChanged({
  parent,
  planned,
  metricIds,
}: {
  parent: ParentMetricSettings;
  planned: ParentMetricSettings;
  metricIds: Iterable<string>;
}): boolean {
  // Neither side stores whether a metric is inverse, so flipping it goes unseen.
  return [...metricIds].some((id) => {
    const before = getStoredStatsEngineInputs(parent, id);
    const now = getStoredStatsEngineInputs(planned, id);
    return !before || !now || !isEqual(before, now);
  });
}
