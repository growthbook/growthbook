import { useMemo, ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { FeaturePrerequisite } from "shared/src/validators/shared";
import {
  renderFeatureDefaultValue,
  renderFeatureRules,
  normalizeFeatureRules,
  featureRuleChangeBadges,
  renderEnvironmentsEnabled,
  renderEnvPrerequisites,
  renderPrerequisites,
  renderRevisionMetadata,
} from "@/components/Features/FeatureDiffRenders";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

// Helper
export const featureToFeatureRevisionDiffInput = (
  feature: FeatureInterface,
): FeatureRevisionDiffInput => {
  const environmentsEnabled: Record<string, boolean> = {};
  const envPrerequisites: Record<string, FeaturePrerequisite[]> = {};
  for (const [envId, env] of Object.entries(
    feature.environmentSettings || {},
  )) {
    environmentsEnabled[envId] = env.enabled;
    if (env.prerequisites) {
      envPrerequisites[envId] = env.prerequisites;
    }
  }

  return {
    defaultValue: feature.defaultValue,
    rules: Object.fromEntries(
      Object.entries(feature.environmentSettings).map(([envId, env]) => [
        envId,
        env.rules,
      ]),
    ),
    environmentsEnabled,
    envPrerequisites,
    prerequisites: feature.prerequisites,
    metadata: {
      description: feature.description,
      owner: feature.owner,
      project: feature.project,
      tags: feature.tags,
      neverStale: feature.neverStale,
      customFields: feature.customFields,
      jsonSchema: feature.jsonSchema,
      valueType: feature.valueType,
    },
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
  | "defaultValue"
  | "rules"
  | "environmentsEnabled"
  | "envPrerequisites"
  | "prerequisites"
  | "metadata"
>;

export type FeatureRevisionDiff = {
  title: string;
  a: string;
  b: string;
  customRender?: ReactNode;
  badges?: DiffBadge[];
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

    // Compare default values using semantic equality (parsed) so we don't show
    // a diff when only formatting/whitespace differs (e.g. "true" vs "true ").
    const currentDefault = current.defaultValue ?? "";
    const draftDefault = draft.defaultValue ?? "";
    const aValue = parseDefaultValue(currentDefault);
    const bValue = parseDefaultValue(draftDefault);
    if (!isEqual(aValue, bValue)) {
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
        badges: [{ label: "Edit default value", action: "edit default value" }],
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
          customRender: renderFeatureRules(currentRules, draftRules),
          badges: featureRuleChangeBadges(currentRules, draftRules, envId),
        });
      }
    });

    // environmentsEnabled: only check envs present in draft
    const draftEnabledEnvs = Object.keys(draft.environmentsEnabled || {});
    draftEnabledEnvs.forEach((envId) => {
      const currentVal = current.environmentsEnabled?.[envId];
      const draftVal = draft.environmentsEnabled?.[envId];
      if (currentVal !== draftVal) {
        diffs.push({
          title: `Environment Toggle - ${envId}`,
          a: currentVal !== undefined ? String(currentVal) : "",
          b: draftVal !== undefined ? String(draftVal) : "",
          customRender: renderEnvironmentsEnabled(envId, currentVal, draftVal),
          badges: [
            { label: "Toggle environment", action: "toggle environment" },
          ],
        });
      }
    });

    // envPrerequisites: only check envs present in draft
    const draftEnvPrereqEnvs = Object.keys(draft.envPrerequisites || {});
    draftEnvPrereqEnvs.forEach((envId) => {
      const currentPrereqs = current.envPrerequisites?.[envId] || [];
      const draftPrereqs = draft.envPrerequisites?.[envId] || [];
      if (!isEqual(currentPrereqs, draftPrereqs)) {
        diffs.push({
          title: `Prerequisites - ${envId}`,
          a: JSON.stringify(currentPrereqs, null, 2),
          b: JSON.stringify(draftPrereqs, null, 2),
          customRender: renderEnvPrerequisites(
            envId,
            currentPrereqs,
            draftPrereqs,
          ),
          badges: [
            {
              label: "Edit env prerequisites",
              action: "edit env prerequisites",
            },
          ],
        });
      }
    });

    // prerequisites (feature-level)
    if (draft.prerequisites !== undefined) {
      const currentPrereqs = current.prerequisites || [];
      const draftPrereqs = draft.prerequisites;
      if (!isEqual(currentPrereqs, draftPrereqs)) {
        diffs.push({
          title: "Feature Prerequisites",
          a: JSON.stringify(currentPrereqs, null, 2),
          b: JSON.stringify(draftPrereqs, null, 2),
          customRender: renderPrerequisites(currentPrereqs, draftPrereqs),
          badges: [
            { label: "Edit prerequisites", action: "edit prerequisites" },
          ],
        });
      }
    }

    // metadata: compare each field present in draft.metadata
    if (draft.metadata) {
      const metadataRender = renderRevisionMetadata(
        current.metadata,
        draft.metadata,
      );
      if (metadataRender) {
        diffs.push({
          title: "Feature Settings",
          a: JSON.stringify(current.metadata, null, 2),
          b: JSON.stringify(draft.metadata, null, 2),
          customRender: metadataRender,
          badges: [{ label: "Edit settings", action: "edit settings" }],
        });
      }
    }

    return diffs;
  }, [current, draft]);
}
