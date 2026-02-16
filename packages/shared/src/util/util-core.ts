/**
 * Core util functions with no dependency on features.ts.
 * features.ts imports from here to avoid util <-> features circular dependency.
 */
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

export function isValidEnvironment(
  env: string,
  environments: string[],
): boolean {
  return environments.includes(env);
}

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
  revision?: FeatureRevisionInterface,
  omitDisabledEnvironments: boolean = false,
): MatchingRule[] {
  const matches: MatchingRule[] = [];

  if (feature.environmentSettings) {
    Object.entries(feature.environmentSettings).forEach(
      ([environmentId, settings]) => {
        if (!isValidEnvironment(environmentId, environments)) return;

        if (omitDisabledEnvironments && !settings.enabled) return;

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
      },
    );
  }

  return matches;
}

// Typeguard to help with type narrowing for built-ins such as Array.prototype.filter
export function isDefined<T>(x: T | undefined | null): x is T {
  return x !== undefined && x !== null;
}

export function experimentHasLinkedChanges(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
): boolean {
  if (exp.hasVisualChangesets) return true;
  if (exp.hasURLRedirects) return true;
  if (exp.linkedFeatures && exp.linkedFeatures.length > 0) return true;
  return false;
}

export function includeExperimentInPayload(
  exp: ExperimentInterface | ExperimentInterfaceStringDates,
  linkedFeatures: FeatureInterface[] = [],
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
        Object.keys(feature.environmentSettings ?? {}),
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
