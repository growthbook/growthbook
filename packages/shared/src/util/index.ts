import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { ExperimentReportVariation } from "back-end/types/report";
import { VisualChange } from "back-end/types/visual-changeset";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";

export * from "./features";
export * from "./saved-groups";

export function getAffectedEnvsForExperiment({
  experiment,
}: {
  experiment: ExperimentInterface | ExperimentInterfaceStringDates;
}): string[] {
  // Visual changesets are not environment-scoped, so it affects all of them
  if (experiment.hasVisualChangesets || experiment.hasURLRedirects)
    return ["__ALL__"];

  // TODO: get actual environments for linked feature flags. We are being overly conservative here
  if (experiment.linkedFeatures && experiment.linkedFeatures.length > 0) {
    return ["__ALL__"];
  }

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

export function putBaselineVariationFirst(
  variations: ExperimentReportVariation[],
  baselineVariationIndex: number | null
): ExperimentReportVariation[] {
  if (baselineVariationIndex === null) return variations;

  return [
    variations[baselineVariationIndex],
    ...variations.filter((v, i) => i !== baselineVariationIndex),
  ];
}

export function isAnalysisAllowed(
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings
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

export function experimentHasLinkedChanges(
  exp: ExperimentInterface | ExperimentInterfaceStringDates
): boolean {
  if (exp.hasVisualChangesets) return true;
  if (exp.hasURLRedirects) return true;
  if (exp.linkedFeatures && exp.linkedFeatures.length > 0) return true;
  return false;
}

export function experimentHasLiveLinkedChanges(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
  linkedFeatures: LinkedFeatureInfo[]
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

export function includeExperimentInPayload(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
  linkedFeatures: FeatureInterface[] = []
): boolean {
  // Archived experiments are always excluded
  if (exp.archived) return false;

  if (!experimentHasLinkedChanges(exp)) return false;

  // Exclude if experiment is a draft and there are no visual changes (feature flags always ignore draft experiment rules)
  if (
    !exp.hasVisualChangesets &&
    !exp.hasURLRedirects &&
    exp.status === "draft"
  )
    return false;

  if (!exp.phases?.length) return false;

  // Stopped experiments are only included if they are currently releasing a winning variant
  if (exp.status === "stopped") {
    if (exp.excludeFromPayload) return false;
    if (!exp.releasedVariationId) return false;
  }

  // If there are only linked features, make sure the rules/envs are published
  if (
    linkedFeatures.length > 0 &&
    !exp.hasVisualChangesets &&
    !exp.hasURLRedirects
  ) {
    const hasFeaturesWithPublishedRules = linkedFeatures.some((feature) => {
      if (feature.archived) return false;
      const rules = getMatchingRules(
        feature,
        (r) => r.type === "experiment-ref" && r.experimentId === exp.id,
        Object.keys(feature.environmentSettings)
      );
      return rules.some((r) => {
        if (!r.environmentEnabled) return false;
        if (r.rule.enabled === false) return false;
        return true;
      });
    });

    if (!hasFeaturesWithPublishedRules) {
      return false;
    }
  }

  return true;
}

export function isValidEnvironment(
  env: string,
  environments: string[]
): boolean {
  return environments.includes(env);
}

export const hasVisualChanges = (visualChanges: VisualChange[]) =>
  visualChanges.some((vc) => !!vc.css || !!vc.domMutations.length || !!vc.js);

export type MatchingRule = {
  environmentId: string;
  i: number;
  environmentEnabled: boolean;
  rule: FeatureRule;
};

export function getMatchingRules(
  feature: FeatureInterface,
  filter: (rule: FeatureRule) => boolean,
  environments: string[],
  revision?: FeatureRevisionInterface
): MatchingRule[] {
  const matches: MatchingRule[] = [];

  if (feature.environmentSettings) {
    Object.entries(feature.environmentSettings).forEach(
      ([environmentId, settings]) => {
        if (!isValidEnvironment(environmentId, environments)) return;

        const rules = revision ? revision.rules[environmentId] : settings.rules;

        if (rules) {
          rules.forEach((rule, i) => {
            if (filter(rule)) {
              matches.push({
                rule,
                i,
                environmentEnabled: settings.enabled,
                environmentId,
              });
            }
          });
        }
      }
    );
  }

  return matches;
}

export function isProjectListValidForProject(
  projects?: string[],
  project?: string
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
  defaultValue = false
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

// Typeguard to help with type narrowing for built-ins such as Array.prototype.filter
export function isDefined<T>(x: T | undefined | null): x is T {
  return x !== undefined && x !== null;
}

// eslint-disable-next-line
type Node = [string, any];
// eslint-disable-next-line
export type NodeHandler = (node: Node, object: any) => void;

// Recursively traverses the given object and calls onNode on each key/value pair.
// If onNode modifies the object in place, it walks the new values as they're inserted, updated, or deleted
// eslint-disable-next-line
export const recursiveWalk = (object: any, onNode: NodeHandler) => {
  // Base case: stop recursion once you hit a primitive or null
  if (object === null || typeof object !== "object") {
    return;
  }
  // If currently walking over an object or array, iterate the entries and call onNode before recurring
  Object.entries(object).forEach((node) => {
    onNode(node, object);
    // Recompute the reference for the recursive call as the key may have changed
    recursiveWalk(object[node[0]], onNode);
  });
};

export function truncateString(s: string, numChars: number) {
  if (s.length > numChars) {
    return s.slice(0, numChars) + "...";
  }
  return s;
}

export function formatByteSizeString(numBytes: number, decimalPlaces = 1) {
  if (numBytes == 0) return "0 Bytes";
  const k = 1024,
    sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
    i = Math.floor(Math.log(numBytes) / Math.log(k));
  return (
    parseFloat((numBytes / Math.pow(k, i)).toFixed(decimalPlaces)) +
    " " +
    sizes[i]
  );
}
