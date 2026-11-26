import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";
import { IndexedPValue, PValueCorrection } from "shared/types/stats";
import { calculatePowerScalingFactor } from "../../enterprise/power";
import type { SupplementalField } from "../adjustment-impact";
import { getAnalysisAlpha } from "../analysis-alpha";
import { parseDimensionId } from "../dimension-ids";
import {
  adjustPValues,
  setAdjustedCI,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "../experiments";

function getSupplementalFields(
  results: ExperimentReportResultDimension[],
  goalMetricIds: string[],
): SupplementalField[] {
  const fields = new Set<SupplementalField>();
  results.forEach((result) =>
    result.variations.forEach((variation) =>
      goalMetricIds.forEach((metricId) => {
        const supplementalResults =
          variation.metrics[metricId]?.supplementalResults ?? {};
        (Object.keys(supplementalResults) as SupplementalField[]).forEach(
          (field) => {
            if (supplementalResults[field]) fields.add(field);
          },
        );
      }),
    ),
  );
  return Array.from(fields);
}

// The family as it would be without one adjustment (e.g. CUPED). A metric the
// adjustment does not apply to keeps its own p-value, since it is the same
// either way.
function setSupplementalAdjustedValues({
  results,
  goalMetricIds,
  field,
  pValueCorrection,
  pValueThreshold,
}: {
  results: ExperimentReportResultDimension[];
  goalMetricIds: string[];
  field: SupplementalField;
  pValueCorrection: NonNullable<PValueCorrection>;
  pValueThreshold: number;
}): void {
  const pValues: IndexedPValue[] = [];
  results.forEach((result, i) =>
    result.variations.forEach((variation, j) =>
      goalMetricIds.forEach((metricId) => {
        const metric = variation.metrics[metricId];
        if (metric?.pValue === undefined) return;
        const supplemental = metric.supplementalResults?.[field];
        const supplementalPValue =
          supplemental && "pValue" in supplemental
            ? supplemental.pValue
            : undefined;
        pValues.push({
          pValue: supplementalPValue ?? metric.pValue,
          index: [i, j, metricId],
        });
      }),
    ),
  );
  if (pValues.length === 0) return;

  adjustPValues(pValues, pValueCorrection).forEach(({ pValue, index }) => {
    const [i, j, metricId] = index;
    const supplemental =
      results[i].variations[j].metrics[metricId].supplementalResults?.[field];
    if (!supplemental) return;
    supplemental.pValueAdjusted = pValue;
    setAdjustedCI(supplemental, pValueThreshold);
  });
}

/**
 * Sets the multiple-testing-corrected p-value and CI on each goal metric, in
 * place. One family: goal metrics x variations x every element of `results`
 * (the dimension levels of one analysis).
 */
function applyPValueCorrection({
  results,
  goalMetricIds,
  pValueCorrection,
  pValueThreshold,
}: {
  results: ExperimentReportResultDimension[];
  goalMetricIds: string[];
  pValueCorrection: PValueCorrection;
  pValueThreshold: number;
}): void {
  if (!pValueCorrection) return;

  const goalIds = Array.from(new Set(goalMetricIds));
  setAdjustedPValuesOnResults(results, goalIds, pValueCorrection);
  setAdjustedCIs(results, pValueThreshold);
  getSupplementalFields(results, goalIds).forEach((field) =>
    setSupplementalAdjustedValues({
      results,
      goalMetricIds: goalIds,
      field,
      pValueCorrection,
      pValueThreshold,
    }),
  );
}

type AnalysisSettingsForCorrection = Pick<
  ExperimentSnapshotAnalysisSettings,
  | "statsEngine"
  | "dimensions"
  | "pValueCorrection"
  | "pValueThreshold"
  | "useCovariateAsResponse"
>;

/** Whether an analysis's goal metrics get a multiple-testing correction at all. */
export function isPValueCorrected(
  settings: Pick<
    AnalysisSettingsForCorrection,
    "statsEngine" | "dimensions" | "useCovariateAsResponse"
  >,
): boolean {
  if (settings.statsEngine !== "frequentist") return false;
  if (settings.useCovariateAsResponse) return false;
  // Each day is another look at the same test, not a separate subgroup.
  const dimensionId = settings.dimensions[0];
  return !dimensionId || parseDimensionId(dimensionId).kind !== "date";
}

/** Corrects the goal metrics' p-values and CIs for one analysis, in place. */
export function setCorrectedPValues({
  results,
  analysisSettings,
  snapshotSettings,
}: {
  results: ExperimentReportResultDimension[];
  analysisSettings: AnalysisSettingsForCorrection;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "goalMetrics">;
}): void {
  applyPValueCorrection({
    results,
    goalMetricIds: snapshotSettings.goalMetrics,
    pValueCorrection: isPValueCorrected(analysisSettings)
      ? (analysisSettings.pValueCorrection ?? null)
      : null,
    pValueThreshold:
      analysisSettings.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
  });
}

type AnalysisSettingsForPower = Pick<
  ExperimentSnapshotAnalysisSettings,
  | "statsEngine"
  | "pValueThreshold"
  | "sequentialTesting"
  | "sequentialTestingTuningParameter"
>;

// The stats engine returns the power inputs for each test it decides needs
// them. How much more sample a test needs also depends on how many goal
// metrics share the experiment's power, so it is worked out here.
function setPowerScalingFactors(
  results: ExperimentReportResultDimension[],
  analysisSettings: AnalysisSettingsForPower,
  snapshotSettings: Pick<ExperimentSnapshotSettings, "goalMetrics">,
): void {
  const settings = {
    alpha: getAnalysisAlpha(analysisSettings),
    numGoalMetrics: new Set(snapshotSettings.goalMetrics).size,
    sequential: analysisSettings.sequentialTesting ?? false,
    sequentialTuningParameter:
      Number(analysisSettings.sequentialTestingTuningParameter) ||
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  };
  results.forEach((result) =>
    result.variations.forEach((variation) =>
      Object.values(variation.metrics).forEach((metric) => {
        if (!metric.power) return;
        const outcome = calculatePowerScalingFactor(metric.power, settings);
        if (outcome) metric.power = { ...metric.power, ...outcome };
      }),
    ),
  );
}

/**
 * Adds every value that depends on more than one test to the results of one
 * analysis, in place. Runs once, right after the stats engine returns.
 */
export function enrichAnalysisResults({
  results,
  analysisSettings,
  snapshotSettings,
}: {
  results: ExperimentReportResultDimension[];
  analysisSettings: AnalysisSettingsForCorrection & AnalysisSettingsForPower;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "goalMetrics">;
}): void {
  setCorrectedPValues({ results, analysisSettings, snapshotSettings });
  setPowerScalingFactors(results, analysisSettings, snapshotSettings);
}

/**
 * For analyses saved before the correction was stored with the results:
 * computes it in memory with the current setting. An analysis that records its
 * own correction (including none) is left alone.
 */
export function fillLegacyPValueCorrection({
  snapshot,
  pValueCorrection,
  hydratedMetricIds,
}: {
  snapshot: Pick<ExperimentSnapshotInterface, "analyses" | "settings">;
  pValueCorrection: PValueCorrection;
  // Set when only some metrics' results were loaded.
  hydratedMetricIds?: string[];
}): void {
  if (!pValueCorrection) return;
  const goalMetrics = snapshot.settings.goalMetrics ?? [];
  // The correction needs every goal metric's p-value.
  if (
    hydratedMetricIds &&
    !goalMetrics.every((id) => hydratedMetricIds.includes(id))
  ) {
    return;
  }

  snapshot.analyses.forEach((analysis) => {
    if (analysis.settings.pValueCorrection !== undefined) return;
    if (!isPValueCorrected(analysis.settings)) return;
    if (!analysis.results?.length) return;
    setCorrectedPValues({
      results: analysis.results,
      analysisSettings: { ...analysis.settings, pValueCorrection },
      snapshotSettings: { goalMetrics },
    });
  });
}

/** The correction an analysis was computed with, if it recorded one. */
export function getAnalysisPValueCorrection(
  analysis:
    | { settings: Pick<ExperimentSnapshotAnalysisSettings, "pValueCorrection"> }
    | null
    | undefined,
  fallback: PValueCorrection | undefined,
): PValueCorrection {
  const recorded = analysis?.settings.pValueCorrection;
  return recorded !== undefined ? recorded : (fallback ?? null);
}

/** The p-value threshold an analysis was computed with, if it recorded one. */
export function getAnalysisPValueThreshold(
  analysis:
    | { settings: Pick<ExperimentSnapshotAnalysisSettings, "pValueThreshold"> }
    | null
    | undefined,
  fallback: number,
): number {
  return analysis?.settings.pValueThreshold ?? fallback;
}

/**
 * JSON has no Infinity, so the open corrected interval of an adjusted p-value
 * of 1 reaches the browser with null bounds. Returns the result with them
 * restored, or the same object when there is nothing to restore.
 */
export function restoreOpenAdjustedCI<
  T extends Pick<SnapshotMetric, "ciAdjusted">,
>(stats: T): T {
  const ci: readonly (number | null)[] | undefined = stats.ciAdjusted;
  if (!ci || (ci[0] !== null && ci[1] !== null)) return stats;
  return { ...stats, ciAdjusted: [ci[0] ?? -Infinity, ci[1] ?? Infinity] };
}
