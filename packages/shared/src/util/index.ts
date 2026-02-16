import uniqid from "uniqid";
import lodash from "lodash";
const { isEqual } = lodash;
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentReportVariation } from "shared/types/report";
import { Environment } from "shared/types/organization";
import { VisualChange } from "shared/types/visual-changeset";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "../validators/safe-rollout-snapshot.js";
import { HoldoutInterfaceStringDates } from "../validators/holdout.js";
import { experimentHasLinkedChanges, getMatchingRules } from "./util-core.js";
import { featureHasEnvironment } from "./features.js";

// Export first so DEFAULT_ENVIRONMENT_IDS is available when circular deps load util
export { DEFAULT_ENVIRONMENT_IDS } from "./constants.js";
export * from "./walk.js";
export {
  getMatchingRules,
  includeExperimentInPayload,
  isDefined,
  isValidEnvironment,
  experimentHasLinkedChanges,
  type MatchingRule,
} from "./util-core.js";

export function getAffectedEnvsForExperiment({
  experiment,
  orgEnvironments,
  linkedFeatures,
}: {
  experiment: ExperimentInterface | ExperimentInterfaceStringDates;
  orgEnvironments: Environment[];
  linkedFeatures?: FeatureInterface[];
}): string[] {
  if (!orgEnvironments.length) {
    return [];
  }
  // Visual changesets are not environment-scoped, so it affects all of them
  // Also fallback to all envs if linkedFeatures is undefined, but the experiment does actually have linked features
  if (
    experiment.hasVisualChangesets ||
    experiment.hasURLRedirects ||
    (!linkedFeatures && !!experiment.linkedFeatures?.length)
  )
    return ["__ALL__"];

  if (linkedFeatures?.length) {
    const envs = new Set<string>();
    const orgEnvIds = orgEnvironments.map((e) => e.id);
    linkedFeatures.forEach((linkedFeature) => {
      const matches = getMatchingRules(
        linkedFeature,
        (rule) =>
          (rule.type === "experiment-ref" &&
            rule.enabled &&
            rule.experimentId === experiment.id) ||
          false,
        orgEnvIds,
        undefined,
        // the boolean below skips environments if they are disabled on the feature
        true,
      );

      // if we find any matching rules get the environments that are affected
      if (matches.length) {
        matches.forEach((match) => {
          const env = orgEnvironments.find(
            (env) => env.id === match.environmentId,
          );

          if (env) {
            if (featureHasEnvironment(linkedFeature, env)) {
              envs.add(match.environmentId);
            }
          }
        });
      }
    });
    return Array.from(envs);
  }
  return [];
}

export function getSnapshotAnalysis(
  snapshot: ExperimentSnapshotInterface,
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null,
): ExperimentSnapshotAnalysis | null {
  // TODO make it so order doesn't matter
  return (
    (analysisSettings
      ? snapshot?.analyses?.find((a) => isEqual(a.settings, analysisSettings))
      : snapshot?.analyses?.[0]) || null
  );
}

export function getSafeRolloutSnapshotAnalysis(
  snapshot: SafeRolloutSnapshotInterface,
  analysisSettings?: SafeRolloutSnapshotAnalysisSettings | null,
): SafeRolloutSnapshotAnalysis | null {
  return (
    (analysisSettings
      ? snapshot?.analyses?.find((a) => isEqual(a.settings, analysisSettings))
      : snapshot?.analyses?.[0]) || null
  );
}
export function putBaselineVariationFirst(
  variations: ExperimentReportVariation[],
  baselineVariationIndex: number | null,
): ExperimentReportVariation[] {
  if (baselineVariationIndex === null) return variations;

  return [
    variations[baselineVariationIndex],
    ...variations.filter((v, i) => i !== baselineVariationIndex),
  ];
}

export function isAnalysisAllowed(
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings,
): boolean {
  // Analysis dimensions must be subset of snapshot dimensions
  const snapshotDimIds = snapshotSettings.dimensions.map((d) => d.id);
  if (!analysisSettings.dimensions.every((d) => snapshotDimIds.includes(d))) {
    return false;
  }

  // CUPED only available if available in snapshot
  if (
    !snapshotSettings.regressionAdjustmentEnabled &&
    analysisSettings.regressionAdjusted
  ) {
    return false;
  }

  return true;
}

export function generateVariationId() {
  return uniqid("var_");
}

export function experimentHasLiveLinkedChanges(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
  linkedFeatures: LinkedFeatureInfo[],
) {
  if (!experimentHasLinkedChanges(exp)) return false;
  if (linkedFeatures.length > 0) {
    if (linkedFeatures.some((feature) => feature.state === "live")) {
      return true;
    }
    return false;
  }
  return true;
}

export function includeHoldoutInPayload(
  holdout: HoldoutInterfaceStringDates,
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
): boolean {
  // Archived experiments are always excluded
  if (exp.archived) return false;

  if (
    Object.keys(holdout.linkedExperiments).length === 0 &&
    Object.keys(holdout.linkedFeatures).length === 0
  )
    return false;

  if (exp.status === "draft") return false;

  if (!exp.phases?.length) return false;

  // Stopped holdouts are not included in the payload
  if (exp.status === "stopped") {
    return false;
  }

  return true;
}

export function hasVisualChanges(visualChanges: VisualChange[]): boolean {
  return visualChanges.some(
    (vc) => !!vc.css || !!vc.domMutations.length || !!vc.js,
  );
}

export function isProjectListValidForProject(
  projects?: string[],
  project?: string,
) {
  // If project list is empty, it's always valid no matter what
  if (!projects || !projects.length) return true;

  // If there is no selected project, it's always valid
  if (!project) return true;

  // Otherwise, it's valid only if the project list contains the selected project
  return projects.includes(project);
}

export function stringToBoolean(
  value: string | undefined,
  defaultValue = false,
): boolean {
  if (value === undefined) return defaultValue;
  if (["true", "yes", "on", "1"].includes(value.toLowerCase())) return true;
  if (["false", "no", "off", "0", ""].includes(value.toLowerCase()))
    return false;
  return defaultValue;
}

export function returnZeroIfNotFinite(x: number): number {
  if (isFinite(x)) {
    return x;
  }
  return 0;
}

export function truncateString(s: string, numChars: number) {
  if (s.length > numChars) {
    return s.slice(0, numChars) + "...";
  }
  return s;
}

export function getNumberFormatDigits(
  value: number,
  highPrecision: boolean = false,
) {
  const absValue = Math.abs(value);
  let digits = absValue > 1000 ? 0 : absValue > 100 ? 1 : absValue > 10 ? 2 : 3;
  // For very small numbers (< 1), find the first significant digit & show 2 digits after it
  if (highPrecision && absValue > 0 && absValue < 1) {
    // Use Math.log10 to find the position of the first significant digit
    const log10 = Math.log10(absValue);
    const decimalPlacesToFirstSig = -Math.floor(log10);
    // Show 2 digits after the first significant digit
    digits = Math.min(decimalPlacesToFirstSig + 1, 15);
  }
  return digits;
}

export function formatByteSizeString(numBytes: number, inferDigits = false) {
  if (numBytes == 0) return "0 Bytes";
  const k = 1024,
    sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
    i = Math.floor(Math.log(numBytes) / Math.log(k));
  const value = numBytes / Math.pow(k, i);

  const options = {
    maximumFractionDigits: inferDigits ? getNumberFormatDigits(value) : 1,
    minimumFractionDigits: 0,
  };

  return Intl.NumberFormat(undefined, options).format(value) + " " + sizes[i];
}

export function meanVarianceFromSums(
  sum: number,
  sum_squares: number,
  n: number,
): number {
  const variance = (sum_squares - Math.pow(sum, 2) / n) / (n - 1);
  return returnZeroIfNotFinite(variance);
}

export function proportionVarianceFromSums(sum: number, n: number): number {
  const mean = sum / n;
  return returnZeroIfNotFinite(mean * (1 - mean));
}

// compare with RatioStatistic.variance in gbstats
export function ratioVarianceFromSums({
  numerator_sum,
  numerator_sum_squares,
  denominator_sum,
  denominator_sum_squares,
  numerator_denominator_sum_product,
  n,
}: {
  numerator_sum: number;
  numerator_sum_squares: number;
  denominator_sum: number;
  denominator_sum_squares: number;
  numerator_denominator_sum_product: number;
  n: number;
}): number {
  const numerator_mean = returnZeroIfNotFinite(numerator_sum / n);
  const numerator_variance = meanVarianceFromSums(
    numerator_sum,
    numerator_sum_squares,
    n,
  );
  const denominator_mean = returnZeroIfNotFinite(denominator_sum / n);
  const denominator_variance = meanVarianceFromSums(
    denominator_sum,
    denominator_sum_squares,
    n,
  );
  const covariance =
    returnZeroIfNotFinite(
      numerator_denominator_sum_product - (numerator_sum * denominator_sum) / n,
    ) /
    (n - 1);

  return returnZeroIfNotFinite(
    numerator_variance / Math.pow(denominator_mean, 2) -
      (2 * covariance * numerator_mean) / Math.pow(denominator_mean, 3) +
      (Math.pow(numerator_mean, 2) * denominator_variance) /
        Math.pow(denominator_mean, 4),
  );
}

export function featuresReferencingSavedGroups({
  savedGroups,
  features,
  environments,
}: {
  savedGroups: SavedGroupInterface[];
  features: FeatureInterface[];
  environments: Environment[];
}): Record<string, FeatureInterface[]> {
  const referenceMap: Record<string, FeatureInterface[]> = {};
  features.forEach((feature) => {
    savedGroups.forEach((savedGroup) => {
      const matches = getMatchingRules(
        feature,
        (rule) =>
          rule.condition?.includes(savedGroup.id) ||
          rule.savedGroups?.some((g) => g.ids.includes(savedGroup.id)) ||
          false,
        environments.map((e) => e.id),
      );

      if (matches.length > 0) {
        referenceMap[savedGroup.id] ||= [];
        referenceMap[savedGroup.id].push(feature);
      }
    });
  });
  return referenceMap;
}

export function experimentsReferencingSavedGroups({
  savedGroups,
  experiments,
}: {
  savedGroups: SavedGroupInterface[];
  experiments: Array<ExperimentInterface | ExperimentInterfaceStringDates>;
}) {
  const referenceMap: Record<
    string,
    Array<ExperimentInterface | ExperimentInterfaceStringDates>
  > = {};
  savedGroups.forEach((savedGroup) => {
    experiments.forEach((experiment) => {
      const matchingPhases = experiment.phases.filter(
        (phase) =>
          phase.condition?.includes(savedGroup.id) ||
          phase.savedGroups?.some((g) => g.ids.includes(savedGroup.id)) ||
          false,
      );

      if (matchingPhases.length > 0) {
        referenceMap[savedGroup.id] ||= [];
        referenceMap[savedGroup.id].push(experiment);
      }
    });
  });
  return referenceMap;
}

export function parseProcessLogBase() {
  let parsedLogBase:
    | {
        // eslint-disable-next-line
        [key: string]: any;
      }
    | null
    | undefined = undefined;
  try {
    if (process.env.LOG_BASE === "null") {
      parsedLogBase = null;
    } else if (process.env.LOG_BASE) {
      parsedLogBase = JSON.parse(process.env.LOG_BASE);
    }
  } catch {
    // Empty catch - don't pass a LOG_BASE
  }

  // Only pass `base` if defined or null
  return typeof parsedLogBase === "undefined"
    ? {}
    : {
        base: parsedLogBase,
      };
}

export function capitalizeFirstCharacter(s: string) {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

export * from "./features.js";
export * from "./saved-groups.js";
export * from "./metric-time-series.js";
export * from "./types.js";
export * from "./errors.js";
