import { getValidDate } from "shared/dates";

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
