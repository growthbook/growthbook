import { useMemo } from "react";
import isEqual from "lodash/isEqual";
import { FeatureRule, FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "../../back-end/types/feature-revision";

// Helper
export const featureToFeatureRevisionDiffInput = (
  feature: FeatureInterface,
): FeatureRevisionDiffInput => {
  return {
    defaultValue: feature.defaultValue,
    rules: Object.fromEntries(
      Object.entries(feature.environmentSettings).map(([envId, env]) => [
        envId,
        env.rules,
      ]),
    ),
  };
};

// Parse JSON strings that look like JSON objects or arrays
const parseIfJson = (str: string | undefined): string => {
  if (!str || typeof str !== "string") return str || "";
  const trimmed = str.trim();
  const isJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const isJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (isJsonObject || isJsonArray) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  return str;
};

// Process rules for diff with special formatting for a few fields
const processRulesForDiff = (rules: FeatureRule[]): FeatureRule[] => {
  if (!Array.isArray(rules)) return rules;

  return rules.map((rule) => {
    const processedRule = { ...rule };

    if (
      "condition" in processedRule &&
      typeof processedRule.condition === "string"
    ) {
      processedRule.condition = parseIfJson(processedRule.condition);
    }

    if ("value" in processedRule && typeof processedRule.value === "string") {
      processedRule.value = parseIfJson(processedRule.value);
    }

    // Safe rollout
    if (
      "controlValue" in processedRule &&
      typeof processedRule.controlValue === "string"
    ) {
      processedRule.controlValue = parseIfJson(processedRule.controlValue);
    }
    if (
      "variationValue" in processedRule &&
      typeof processedRule.variationValue === "string"
    ) {
      processedRule.variationValue = parseIfJson(processedRule.variationValue);
    }

    // Parse variations values (experiment rules, experiment-ref rules)
    if (
      "variations" in processedRule &&
      Array.isArray(processedRule.variations)
    ) {
      processedRule.variations = processedRule.variations.map((variation) => {
        if (typeof variation.value === "string") {
          return { ...variation, value: parseIfJson(variation.value) };
        }
        return variation;
      });
    }

    return processedRule;
  });
};

type FeatureRevisionDiffInput = Pick<
  FeatureRevisionInterface,
  "defaultValue" | "rules"
>;

type FeatureRevisionDiff = {
  title: string;
  a: string;
  b: string;
};

export function useFeatureRevisionDiff({
  current,
  draft,
}: {
  current: FeatureRevisionDiffInput;
  draft: FeatureRevisionDiffInput;
}): FeatureRevisionDiff[] {
  return useMemo(() => {
    const diffs: FeatureRevisionDiff[] = [];

    // Compare default values
    if (current.defaultValue !== draft.defaultValue) {
      const aValue = parseIfJson(current.defaultValue);
      const bValue = parseIfJson(draft.defaultValue);
      diffs.push({
        title: "Default Value",
        a:
          typeof aValue === "string" ? aValue : JSON.stringify(aValue, null, 2),
        b:
          typeof bValue === "string" ? bValue : JSON.stringify(bValue, null, 2),
      });
    }

    // Get all unique environment IDs from both current and draft
    const allEnvironments = new Set([
      ...Object.keys(current.rules || {}),
      ...Object.keys(draft.rules || {}),
    ]);

    // Compare rules per environment
    allEnvironments.forEach((envId) => {
      const currentRules = current.rules?.[envId] || [];
      const draftRules = draft.rules?.[envId] || [];

      if (!isEqual(currentRules, draftRules)) {
        const processedCurrentRules = processRulesForDiff(currentRules);
        const processedDraftRules = processRulesForDiff(draftRules);
        diffs.push({
          title: `Rules - ${envId}`,
          a: JSON.stringify(processedCurrentRules, null, 2),
          b: JSON.stringify(processedDraftRules, null, 2),
        });
      }
    });

    return diffs;
  }, [current, draft]);
}
