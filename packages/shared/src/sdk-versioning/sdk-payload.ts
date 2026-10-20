import { FeatureValueType } from "../validators";
import { SDKCapability } from "./types";

// Base feature keys
export const STRICT_FEATURE_KEYS = ["defaultValue", "rules"] as const;

// Base feature rule keys
export const STRICT_FEATURE_RULE_KEYS = [
  "key",
  "variations",
  "weights",
  "coverage",
  "condition",
  "namespace",
  "force",
  "hashAttribute",
] as const;

export const BUCKETING_V2_RULE_KEYS = [
  "hashVersion",
  "range",
  "ranges",
  "meta",
  "seed",
  "name",
  "phase",
] as const;

export const NAMESPACES_V2_RULE_KEYS = ["filters"] as const;

export const STICKY_BUCKETING_RULE_KEYS = [
  "fallbackAttribute",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
] as const;

export const PREREQUISITE_RULE_KEYS = ["parentConditions"] as const;

export const CONTEXTUAL_BANDIT_RULE_KEYS = [
  // `contextualBanditRef` (presence identifies a CB rule) points into the top-level contextualBandits map.
  "contextualBanditRef",
  // CB rules store their variations here (not under `variations`) so that
  // SDKs without the contextualBandits capability drop this key and, seeing no
  // `variations`, skip the rule instead of running it as a plain experiment.
  "contextualVariations",
] as const;

export function getPayloadAllowedKeys(capabilities: SDKCapability[]): {
  featureKeys: readonly string[];
  featureRuleKeys: readonly string[];
  removedExperimentKeys: string[];
} {
  const featureRuleKeys = [
    ...STRICT_FEATURE_RULE_KEYS,
    ...(capabilities.includes("bucketingV2") ? BUCKETING_V2_RULE_KEYS : []),
    ...(capabilities.includes("namespacesV2") ? NAMESPACES_V2_RULE_KEYS : []),
    ...(capabilities.includes("stickyBucketing")
      ? STICKY_BUCKETING_RULE_KEYS
      : []),
    ...(capabilities.includes("prerequisites") ? PREREQUISITE_RULE_KEYS : []),
    ...(capabilities.includes("contextualBandits")
      ? CONTEXTUAL_BANDIT_RULE_KEYS
      : []),
  ];
  const removedExperimentKeys = capabilities.includes("prerequisites")
    ? []
    : [...PREREQUISITE_RULE_KEYS];
  return {
    featureKeys: [...STRICT_FEATURE_KEYS],
    featureRuleKeys,
    removedExperimentKeys,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getJSONValue(type: FeatureValueType, value: string): any {
  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (type === "number") return parseFloat(value) || 0;
  if (type === "string") return value;
  if (type === "boolean") return value === "false" ? false : true;
  return null;
}
