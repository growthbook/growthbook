import { getValidDate } from "shared/dates";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import type { ExposureQuery } from "shared/types/datasource";
import type {
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { OrganizationSettings } from "shared/types/organization";
import type { PValueCorrection, StatsEngine } from "shared/types/stats";
import { resolveAnalysisIdentifierType } from "../util/exposure-queries";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getClusterSubUnit,
} from "./experiments";
import { getSnapshotDataAsOfDate } from "./new-metrics-update";
import { isPValueCorrected } from "./results/enrich";
import { getLatestPhaseVariations } from "./variations";

export const EXPERIMENT_OUTDATED_REASON_LABELS = {
  activationMetric: "Activation metric changed",
  attributionModel: "Attribution model changed",
  queryFilter: "Query filter changed",
  segment: "Segment changed",
  skipPartialData: "In-progress conversion behavior changed",
  datasourceId: "Data source changed",
  exposureQueryId: "Experiment assignment query changed",
  exposureQueryIdentifierType: "Experiment assignment identifier type changed",
  isClusterExperiment: "Cluster analysis setting changed",
  clusterSubUnitIdentifier: "Cluster subunit identifier changed",
  startDate: "Analysis start date changed",
  regressionAdjustmentEnabled: "CUPED settings changed",
} as const;

export type ExperimentOutdatedReasonField =
  keyof typeof EXPERIMENT_OUTDATED_REASON_LABELS;

export function isExperimentOutdatedReasonField(
  field: string,
): field is ExperimentOutdatedReasonField {
  return Object.prototype.hasOwnProperty.call(
    EXPERIMENT_OUTDATED_REASON_LABELS,
    field,
  );
}

export function getExperimentOutdatedReasonLabel(
  field: ExperimentOutdatedReasonField,
): string {
  return EXPERIMENT_OUTDATED_REASON_LABELS[field];
}

const ANALYSIS_DATE_DRIFT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isDifferentDate(val1: Date, val2: Date) {
  return (
    Math.abs(val1.getTime() - val2.getTime()) >=
    ANALYSIS_DATE_DRIFT_THRESHOLD_MS
  );
}

/**
 * True when the phase's date range differs from the snapshot's by a day or
 * more. A phase without an end date is compared against now, so this also
 * flags results as stale as time passes. Results whose updates are disabled
 * (see isExperimentResultsUpdateDisabled) can't change, so date logic never
 * marks them outdated; only analysis settings drift does.
 */
export function isAnalysisDateRangeOutdated({
  phase,
  snapshotSettings,
  snapshotDateCreated,
  resultsUpdateDisabled = false,
}: {
  phase?: { dateStarted?: string | Date; dateEnded?: string | Date } | null;
  snapshotSettings: {
    startDate: string | Date;
    endDate: string | Date;
    endDateIsCutoff?: boolean;
  };
  snapshotDateCreated?: string | Date;
  resultsUpdateDisabled?: boolean;
}): boolean {
  if (resultsUpdateDisabled) return false;
  return (
    isDifferentDate(
      getValidDate(phase?.dateStarted ?? ""),
      getValidDate(snapshotSettings.startDate),
    ) ||
    // A running phase analyzed through a lagged cutoff ends before the
    // snapshot ran, so measure its staleness from the run time.
    isDifferentDate(
      getValidDate(phase?.dateEnded ?? ""),
      getValidDate(
        !phase?.dateEnded && snapshotSettings.endDateIsCutoff
          ? snapshotDateCreated
          : snapshotSettings.endDate,
      ),
    )
  );
}

const RESULTS_OUTDATED_REASON_LABELS = {
  stats_engine: "Stats engine changed",
  activation_metric: EXPERIMENT_OUTDATED_REASON_LABELS.activationMetric,
  segment: EXPERIMENT_OUTDATED_REASON_LABELS.segment,
  query_filter: EXPERIMENT_OUTDATED_REASON_LABELS.queryFilter,
  conversion_behavior: EXPERIMENT_OUTDATED_REASON_LABELS.skipPartialData,
  assignment_query: EXPERIMENT_OUTDATED_REASON_LABELS.exposureQueryId,
  identifier_type:
    EXPERIMENT_OUTDATED_REASON_LABELS.exposureQueryIdentifierType,
  cluster_analysis: EXPERIMENT_OUTDATED_REASON_LABELS.isClusterExperiment,
  cluster_sub_unit: EXPERIMENT_OUTDATED_REASON_LABELS.clusterSubUnitIdentifier,
  attribution_model: EXPERIMENT_OUTDATED_REASON_LABELS.attributionModel,
  metrics_changed: "Metrics changed",
  p_value_correction: "P-value correction changed",
  goal_metrics_changed: "Goal metrics changed (p-value correction affected)",
  variations_changed: "Variations changed",
  analysis_dates_changed: "Analysis dates changed",
  p_value_threshold: "P-value threshold changed",
  cuped: EXPERIMENT_OUTDATED_REASON_LABELS.regressionAdjustmentEnabled,
  post_stratification: "Post-stratification settings changed",
  sequential_testing: "Sequential testing settings changed",
  newer_overall_results: "Newer Overall Results are available",
} as const;

export type ResultsOutdatedReason = keyof typeof RESULTS_OUTDATED_REASON_LABELS;

export function getResultsOutdatedReasonLabel(
  reason: ResultsOutdatedReason,
): string {
  return RESULTS_OUTDATED_REASON_LABELS[reason];
}

export type ResultsOutdatedExperiment = Pick<
  ExperimentInterface,
  | "type"
  | "variations"
  | "goalMetrics"
  | "secondaryMetrics"
  | "guardrailMetrics"
  | "activationMetric"
  | "segment"
  | "queryFilter"
  | "skipPartialData"
  | "exposureQueryId"
  | "exposureQueryIdentifierType"
  | "isClusterExperiment"
  | "clusterSubUnitIdentifier"
  | "attributionModel"
  | "regressionAdjustmentEnabled"
  | "postStratificationEnabled"
  | "sequentialTestingEnabled"
  | "sequentialTestingTuningParameter"
> & {
  phases: (Pick<ExperimentPhase, "variations"> & {
    dateStarted?: string | Date;
    dateEnded?: string | Date;
  })[];
};

/**
 * Why an analysis's stored multiple-testing correction no longer matches the
 * experiment. The correction is computed when results update, from the method
 * and the goal metrics at that time, so a change to either only shows up after
 * the next update.
 */
export function getPValueCorrectionOutdatedReasons({
  analysisSettings,
  currentPValueCorrection,
  snapshotGoalMetrics,
  currentGoalMetrics,
}: {
  analysisSettings: Pick<
    ExperimentSnapshotAnalysisSettings,
    "statsEngine" | "dimensions" | "useCovariateAsResponse" | "pValueCorrection"
  >;
  currentPValueCorrection: PValueCorrection | undefined;
  snapshotGoalMetrics: string[];
  currentGoalMetrics: string[];
}): Extract<
  ResultsOutdatedReason,
  "p_value_correction" | "goal_metrics_changed"
>[] {
  if (!isPValueCorrected(analysisSettings)) return [];

  const reasons: ReturnType<typeof getPValueCorrectionOutdatedReasons> = [];
  const current = currentPValueCorrection ?? null;
  // An analysis that recorded no method is corrected with the current one
  // each time it is read, so its method is never out of date.
  const recorded = analysisSettings.pValueCorrection;
  if (recorded !== undefined && recorded !== current) {
    reasons.push("p_value_correction");
  }

  const applied = recorded !== undefined ? recorded : current;
  const snapshotGoals = new Set(snapshotGoalMetrics);
  const currentGoals = new Set(currentGoalMetrics);
  if (
    applied &&
    (snapshotGoals.size !== currentGoals.size ||
      [...snapshotGoals].some((id) => !currentGoals.has(id)))
  ) {
    reasons.push("goal_metrics_changed");
  }

  return reasons;
}

function isDifferent(
  val1?: string | boolean | number | null,
  val2?: string | boolean | number | null,
) {
  if (!val1 && !val2) return false;
  return val1 !== val2;
}

function isDifferentStringArray(val1: string[], val2: string[]) {
  if (val1.length !== val2.length) return true;
  // Order matters: snapshot results are indexed by variation position.
  return val1.some((v, i) => v !== val2[i]);
}

function isStringArrayMissingElements(strings: string[], elements: string[]) {
  if (!elements.length) return false;
  if (elements.length > strings.length) return true;
  return elements.some((v) => !strings.includes(v));
}

/**
 * Why an experiment's current results no longer match its settings, in the
 * order the Outdated badge lists them. Empty when they still match.
 */
export function getResultsOutdatedReasons({
  experiment: exp,
  snapshot,
  metricGroups,
  orgSettings: org,
  pValueThreshold,
  statsEngine,
  features,
  phase,
  exposureQueries,
  unjoinableMetricIds,
  conversionWindowMetricIds,
  newerOverallResultsAvailable,
  resultsUpdateDisabled,
}: {
  experiment: ResultsOutdatedExperiment;
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "settings" | "analyses" | "type" | "dateCreated" | "updateScope"
  >;
  metricGroups: MetricGroupInterface[];
  orgSettings: Pick<
    OrganizationSettings,
    | "disablePrecomputedDimensions"
    | "pValueCorrection"
    | "postStratificationEnabled"
    | "sequentialTestingEnabled"
    | "sequentialTestingTuningParameter"
  >;
  pValueThreshold: number;
  statsEngine: StatsEngine;
  features: {
    regressionAdjustment: boolean;
    postStratification: boolean;
    sequentialTesting: boolean;
  };
  phase: number;
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[];
  unjoinableMetricIds: ReadonlySet<string>;
  conversionWindowMetricIds: ReadonlySet<string>;
  newerOverallResultsAvailable: boolean;
  resultsUpdateDisabled: boolean;
}): ResultsOutdatedReason[] {
  const snapshotSettings = snapshot.settings;
  const analysisSettings = snapshot.analyses[0]?.settings;
  if (!analysisSettings) return [];

  const reasons: ResultsOutdatedReason[] = [];

  if (
    isDifferent(
      analysisSettings.statsEngine || DEFAULT_STATS_ENGINE,
      statsEngine || DEFAULT_STATS_ENGINE,
    )
  ) {
    reasons.push("stats_engine");
  }
  if (isDifferent(exp.activationMetric, snapshotSettings.activationMetric)) {
    reasons.push("activation_metric");
  }
  if (isDifferent(exp.segment, snapshotSettings.segment)) {
    reasons.push("segment");
  }
  if (isDifferent(exp.queryFilter, snapshotSettings.queryFilter)) {
    reasons.push("query_filter");
  }
  if (isDifferent(exp.skipPartialData, snapshotSettings.skipPartialData)) {
    reasons.push("conversion_behavior");
  }
  if (isDifferent(exp.exposureQueryId, snapshotSettings.exposureQueryId)) {
    reasons.push("assignment_query");
  }
  // Resolve both sides so a snapshot saved before identifiers were stored
  // matches an experiment that analyzes on the same identifier.
  if (
    isDifferent(
      resolveAnalysisIdentifierType(
        exposureQueries.find((e) => e.id === exp.exposureQueryId),
        exp.exposureQueryIdentifierType,
      ),
      resolveAnalysisIdentifierType(
        exposureQueries.find((e) => e.id === snapshotSettings.exposureQueryId),
        snapshotSettings.exposureQueryIdentifierType,
      ),
    )
  ) {
    reasons.push("identifier_type");
  }
  // A missing flag means off, and a subunit only counts in cluster mode.
  const expSubUnit = exp.isClusterExperiment
    ? (exp.clusterSubUnitIdentifier ?? null)
    : null;
  const snapshotSubUnit = snapshotSettings.isClusterExperiment
    ? (snapshotSettings.clusterSubUnitIdentifier ?? null)
    : null;
  if (!!exp.isClusterExperiment !== !!snapshotSettings.isClusterExperiment) {
    reasons.push("cluster_analysis");
  } else if (expSubUnit !== snapshotSubUnit) {
    reasons.push("cluster_sub_unit");
  }
  if (
    isDifferent(
      exp.attributionModel || "firstExposure",
      snapshotSettings.attributionModel || "firstExposure",
    )
  ) {
    reasons.push("attribution_model");
  }

  const expandedMetricIds = (ids: string[]) =>
    Array.from(new Set(expandMetricGroups(ids, metricGroups))).filter(
      (m) => !unjoinableMetricIds.has(m),
    );
  const snapshotMetrics = expandedMetricIds(
    getAllMetricIdsFromExperiment(snapshotSettings, false, metricGroups),
  );
  let experimentMetrics = expandedMetricIds(
    getAllMetricIdsFromExperiment(exp, false, metricGroups),
  );
  if (exp.type === "holdout") {
    experimentMetrics = experimentMetrics.filter(
      (m) => !conversionWindowMetricIds.has(m),
    );
  }
  if (isStringArrayMissingElements(snapshotMetrics, experimentMetrics)) {
    reasons.push("metrics_changed");
  }

  // Compared among the metrics the snapshot analyzed: a goal it lacks is
  // already reported as "Metrics changed".
  const goalsInSnapshot = (goalMetrics: string[]) =>
    expandMetricGroups(goalMetrics, metricGroups).filter((m) =>
      snapshotMetrics.includes(m),
    );
  reasons.push(
    ...getPValueCorrectionOutdatedReasons({
      analysisSettings,
      currentPValueCorrection: org.pValueCorrection,
      snapshotGoalMetrics: goalsInSnapshot(snapshotSettings.goalMetrics),
      currentGoalMetrics: goalsInSnapshot(exp.goalMetrics),
    }),
  );

  if (
    isDifferentStringArray(
      getLatestPhaseVariations(exp).map((v) => v.key),
      snapshotSettings.variations.map((v) => v.id),
    )
  ) {
    reasons.push("variations_changed");
  }
  if (
    isAnalysisDateRangeOutdated({
      phase: exp.phases[phase],
      snapshotSettings,
      snapshotDateCreated: getSnapshotDataAsOfDate(snapshot),
      resultsUpdateDisabled,
    })
  ) {
    reasons.push("analysis_dates_changed");
  }
  if (
    isDifferent(
      analysisSettings.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
      pValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
    )
  ) {
    reasons.push("p_value_threshold");
  }

  const experimentRegressionAdjustmentEnabled = features.regressionAdjustment
    ? !!exp.regressionAdjustmentEnabled
    : false;
  if (
    isDifferent(
      experimentRegressionAdjustmentEnabled,
      !!analysisSettings.regressionAdjusted,
    )
  ) {
    reasons.push("cuped");
  }

  // Mirrors the back-end, which stores it as off for cluster experiments.
  const experimentPostStratificationEnabled =
    !features.postStratification ||
    org.disablePrecomputedDimensions ||
    getClusterSubUnit(exp)
      ? false
      : (exp.postStratificationEnabled ??
        org.postStratificationEnabled ??
        DEFAULT_POST_STRATIFICATION_ENABLED);
  if (
    isDifferent(
      experimentPostStratificationEnabled,
      !!analysisSettings.postStratificationEnabled,
    )
  ) {
    reasons.push("post_stratification");
  }

  const experimentSequentialEnabled =
    statsEngine !== "frequentist" || !features.sequentialTesting
      ? false
      : (exp.sequentialTestingEnabled ?? !!org.sequentialTestingEnabled);
  const experimentSequentialTuningParameter: number =
    exp.sequentialTestingTuningParameter ??
    org.sequentialTestingTuningParameter ??
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  if (
    (isDifferent(
      experimentSequentialEnabled,
      !!analysisSettings.sequentialTesting,
    ) ||
      (experimentSequentialEnabled &&
        experimentSequentialTuningParameter !==
          analysisSettings.sequentialTestingTuningParameter)) &&
    statsEngine === "frequentist"
  ) {
    reasons.push("sequential_testing");
  }

  // A breakdown built on incremental Overall Results is outdated once newer
  // Overall Results exist.
  if (newerOverallResultsAvailable) {
    reasons.push("newer_overall_results");
  }

  return reasons;
}
