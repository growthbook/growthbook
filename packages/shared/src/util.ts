import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
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
  analysisSettings?: ExperimentSnapshotAnalysisSettings
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
