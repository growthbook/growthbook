export const EXPERIMENT_OUTDATED_REASON_LABELS = {
  activationMetric: "Activation metric changed",
  attributionModel: "Attribution model changed",
  queryFilter: "Query filter changed",
  segment: "Segment changed",
  skipPartialData: "In-progress conversion behavior changed",
  datasourceId: "Data source changed",
  exposureQueryId: "Experiment assignment query changed",
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
