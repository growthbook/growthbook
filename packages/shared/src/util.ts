import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { ExperimentReportVariation } from "back-end/types/report";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";

export function getAffectedEnvsForExperiment({
  experiment,
}: {
  experiment: ExperimentInterface | ExperimentInterfaceStringDates;
}): string[] {
  // Visual changesets are not environment-scoped, so it affects all of them
  if (experiment.hasVisualChangesets) return ["__ALL__"];
  return [];
}

export function getSnapshotAnalysis(
  snapshot: ExperimentSnapshotInterface,
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null
): ExperimentSnapshotAnalysis | null {
  // TODO make it so order doesn't matter
  return (
    (analysisSettings
      ? snapshot.analyses.find((a) => isEqual(a.settings, analysisSettings))
      : snapshot.analyses[0]) || null
  );
}

export function generateVariationId() {
  return uniqid("var_");
}

export function putBaselineVariationFirst(
  variations: ExperimentReportVariation[],
  baselineVariation: string | null
): ExperimentReportVariation[] {
  if (!baselineVariation) return variations;

  return [
    ...variations.filter((v) => v.name === baselineVariation),
    ...variations.filter((v) => v.name !== baselineVariation),
  ];
}

export function isAnalysisAllowed(snapshotSettings: ExperimentSnapshotSettings, analysisSettings: ExperimentSnapshotAnalysisSettings): boolean {
  // Analysis dimensions must be subset of snapshot dimensions
  const snapshotDimIds = snapshotSettings.dimensions.map((d) => d.id)
  if (!analysisSettings.dimensions.every((d) => snapshotDimIds.includes(d))) {
    return false;
  }

  // CUPED only available if available in snapshot
  if (!snapshotSettings.regressionAdjustmentEnabled && analysisSettings.regressionAdjusted) {
    return false;
  }

  return true;
}