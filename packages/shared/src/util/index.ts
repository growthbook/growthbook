import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
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
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ExperimentReportVariation } from "shared/types/report";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { VisualChange } from "shared/types/visual-changeset";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "../validators/safe-rollout-snapshot";
import { HoldoutInterfaceStringDates } from "../validators/holdout";
import { featureHasEnvironment } from "./features";

export * from "./features";
export * from "./managedWarehouse";
export * from "./saved-groups";
export * from "./metric-time-series";
export * from "./ruleId";
export * from "./numbers";
export * from "./types";
export * from "./errors";
export * from "./namespaces";
export * from "./custom-fields";

export const DEFAULT_ENVIRONMENT_IDS = ["production", "dev", "staging", "test"];

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
  const snapshotDimIds = [
    ...snapshotSettings.dimensions.map((d) => d.id),
    ...(snapshotSettings.precomputedUnitDimensionIds ?? []),
  ];
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
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
): boolean {
  if (exp.hasVisualChangesets) return true;
  if (exp.hasURLRedirects) return true;
  if (exp.linkedFeatures && exp.linkedFeatures.length > 0) return true;
  return false;
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

export function includeExperimentInPayload(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
  linkedFeatures: FeatureInterface[] = [],
): boolean {
  // Archived experiments are always excluded
  if (exp.archived) return false;

  if (!experimentHasLinkedChanges(exp)) return false;

  // Exclude if experiment is a draft and there are no visual changes or redirects (feature flags always ignore draft experiment rules)
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
        Object.keys(feature.environmentSettings),
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

export function isValidEnvironment(
  env: string,
  environments: string[],
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

/**
 * Scan the v2 unified rule array (from `revision.rules` if provided, else
 * `feature.rules`) and emit one `MatchingRule` entry per (rule × applicable
 * env) pair that passes `filter`. Multi-env rules fan out to one entry per
 * env they cover; single-env rules emit exactly one entry. Rules with
 * `allEnvironments: true` fan out across every valid env in `environments`.
 *
 * `i` is the rule's index in the UNIFIED rule array (same across every
 * fan-out entry for a given rule). Callers that identify a rule by
 * `(environmentId, i)` were the v1 contract; under v2 the authoritative
 * match handle is `rule.id` — `i` is preserved only for backward-compatible
 * display/logging.
 */
export function getMatchingRules(
  feature: FeatureInterface,
  filter: (rule: FeatureRule) => boolean,
  environments: string[],
  revision?: FeatureRevisionInterface,
  omitDisabledEnvironments: boolean = false,
): MatchingRule[] {
  const matches: MatchingRule[] = [];
  // Drop sparse `null`/`undefined` slots so the `filter(rule)` callback —
  // which typically reads `rule.type` — can't crash on a corrupt legacy
  // entry (see `naiveFlattenV1Rules` for the same concern).
  const allRules: FeatureRule[] = (
    revision?.rules ??
    feature.rules ??
    []
  ).filter((r): r is FeatureRule => r != null && typeof r === "object");

  allRules.forEach((rule, i) => {
    if (!filter(rule)) return;

    // Resolve the env list this rule applies to. Tri-state:
    //   - `allEnvironments: true`              → every visible env
    //   - `environments: [list]`               → that list (strict membership)
    //   - `environments: []`                   → no envs (intentional "pending"
    //                                            / "ramp not yet scoped" state)
    //   - neither field declared (malformed)   → every visible env (permissive
    //                                            safety net for legacy data)
    const ruleEnvs = rule.allEnvironments
      ? environments
      : rule.environments !== undefined
        ? rule.environments
        : environments;

    ruleEnvs.forEach((environmentId) => {
      if (!isValidEnvironment(environmentId, environments)) return;

      const envSettings = feature.environmentSettings?.[environmentId];
      const environmentEnabled = !!envSettings?.enabled;
      if (omitDisabledEnvironments && !environmentEnabled) return;

      matches.push({
        rule,
        i,
        environmentEnabled,
        environmentId,
      });
    });
  });

  return matches;
}

// Rule scope predicate. Keep aligned with `ruleFootprint`.
//   allEnvironments:true           → true
//   environments:[list]            → list.includes(environment)
//   environments:[]                → false (pending)
//   neither (malformed/legacy)     → true (permissive fallback)
//   nullish/non-object             → false (defensive; pre-v2 docs stored as
//                                    Mongoose `Mixed` can land with sparse
//                                    `null`/`undefined` rule slots)
export function ruleAppliesToEnv(
  rule: FeatureRule,
  environment: string,
): boolean {
  if (rule == null || typeof rule !== "object") return false;
  if (rule.allEnvironments) return true;
  if (rule.environments !== undefined) {
    return Array.isArray(rule.environments)
      ? rule.environments.includes(environment)
      : false;
  }
  return true;
}

// Filter to rules applying to `environment`, preserving input order. Accepts
// nullish for convenience. Non-array input (e.g. a not-yet-JIT-upgraded v1
// revision) returns [] rather than throwing, so the caller's envSettings
// fallback can take over. Nullish slots inside the array are dropped before
// the predicate runs — see `naiveFlattenV1Rules` for the same hardening.
export function getRulesForEnvironment(
  rules: FeatureRule[] | undefined | null,
  environment: string,
): FeatureRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r): r is FeatureRule =>
      r != null && typeof r === "object" && ruleAppliesToEnv(r, environment),
  );
}

// Footprint of a rule, intersected with `applicableEnvs`. Must match
// `ruleAppliesToEnv`.
//   allEnvironments:true           → every applicable env
//   environments:[list]            → list ∩ applicable
//   environments:[]                → [] (pending)
//   neither (malformed/legacy)     → every applicable env (permissive fallback)
export function ruleFootprint(
  rule: FeatureRule,
  applicableEnvs: string[],
): string[] {
  if (rule.allEnvironments) return applicableEnvs;
  if (rule.environments === undefined) return applicableEnvs;
  const applicableSet = new Set(applicableEnvs);
  return rule.environments.filter((e) => applicableSet.has(e));
}

// Naive v1→v2 flattener for diff/merge/preview paths. Coerces an ambiguous
// rules blob into a flat FeatureRule[] without dedup or id-collision repair:
//   FeatureRule[]                → pass-through
//   Record<env, FeatureRule[]>   → flatten, stamping `environments: [env]`
//   nullish / other              → []
// NOT for persistence — content-identical rules across envs come out as
// duplicate ids. Persistence paths must use `normalizeRulesInputToV2` on the
// back-end, which dedupes by id, collapses to allEnvironments, and suffixes
// collisions.
// Hardening: pre-v2 docs stored as Mongoose `Mixed` can land with sparse
// `null`/`undefined` rule slots (partial imports, hand-edited backups). A
// single nullish entry would crash every downstream `.type` / `.id` /
// `.environments` accessor (see PR #5800). Filter at the chokepoint so
// `autoMerge`, `tryRuleLevelMerge`, and the diff helpers above never see
// a nullish rule. The object branch also drops nullish entries before the
// spread that would otherwise produce a typeless "rule" record.
const isPlausibleRule = (v: unknown): v is FeatureRule =>
  v != null && typeof v === "object" && !Array.isArray(v);

export function naiveFlattenV1Rules(input: unknown): FeatureRule[] {
  if (input == null) return [];
  if (Array.isArray(input)) {
    // Common case (v2-shaped arrays from JIT migration): pass through by
    // reference so callers can rely on identity. Only allocate when a
    // sparse/legacy slot needs to be scrubbed.
    return input.every(isPlausibleRule)
      ? (input as FeatureRule[])
      : input.filter(isPlausibleRule);
  }
  if (typeof input === "object") {
    const out: FeatureRule[] = [];
    for (const [env, rules] of Object.entries(
      input as Record<string, FeatureRule[]>,
    )) {
      if (!Array.isArray(rules)) continue;
      for (const r of rules) {
        if (!isPlausibleRule(r)) continue;
        out.push({
          ...r,
          allEnvironments: false,
          environments: [env],
        } as FeatureRule);
      }
    }
    return out;
  }
  return [];
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

export {
  NON_PRODUCTION_ENV_PATTERNS,
  isEnvironmentDevLike,
} from "./environments";
