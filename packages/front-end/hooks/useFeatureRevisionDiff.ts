import { useMemo, ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  renderFeatureDefaultValue,
  renderFeatureRules,
  normalizeFeatureRules,
} from "@/components/Features/FeatureDiffRenders";

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

// Parse a defaultValue string that may be an embedded JSON object or array.
// Only handles `{...}` / `[...]` patterns to match normalizeFeatureRules behavior.
function parseDefaultValue(str: string): unknown {
  const trimmed = str.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // not valid JSON
    }
  }
  return str;
}

export type FeatureRevisionDiffInput = Pick<
  FeatureRevisionInterface,
  "defaultValue" | "rules"
>;

export type FeatureRevisionDiff = {
  title: string;
  a: string;
  b: string;
  customRender?: ReactNode;
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
      const aValue = parseDefaultValue(current.defaultValue);
      const bValue = parseDefaultValue(draft.defaultValue);
      diffs.push({
        title: "Default Value",
        a:
          typeof aValue === "string" ? aValue : JSON.stringify(aValue, null, 2),
        b:
          typeof bValue === "string" ? bValue : JSON.stringify(bValue, null, 2),
        customRender: renderFeatureDefaultValue(
          current.defaultValue,
          draft.defaultValue,
        ),
      });
    }

    // Only iterate over environments present in draft
    // (environments not in draft weren't modified and shouldn't show a diff)
    const draftEnvironments = Object.keys(draft.rules || {});

    // Compare rules per environment
    draftEnvironments.forEach((envId) => {
      const currentRules = current.rules?.[envId] || [];
      const draftRules = draft.rules?.[envId] || [];

      if (!isEqual(currentRules, draftRules)) {
        diffs.push({
          title: `Rules - ${envId}`,
          a: JSON.stringify(normalizeFeatureRules(currentRules), null, 2),
          b: JSON.stringify(normalizeFeatureRules(draftRules), null, 2),
          // Pass original (un-normalized) rules to the human-readable render;
          // formatValue and toConditionString both handle raw JSON strings.
          customRender: renderFeatureRules(currentRules, draftRules),
        });
      }
    });

    return diffs;
  }, [current, draft]);
}
