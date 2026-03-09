import { useMemo, ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { RevisionMetadata } from "shared/src/validators/features";
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
  prerequisiteChangeBadges,
} from "@/components/Features/FeatureDiffRenders";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

// Helper
// Normalize nullable metadata fields to canonical empty values so that
// null vs "" (strings) and null vs [] (tags) don't produce false diffs.
export function normalizeRevisionMetadata(
  m: RevisionMetadata | null | undefined,
): RevisionMetadata | undefined {
  if (!m) return undefined;
  return {
    ...m,
    description: m.description ?? "",
    owner: m.owner ?? "",
    project: m.project ?? "",
    tags: m.tags ?? [],
  };
}

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
    metadata: normalizeRevisionMetadata({
      description: feature.description,
      owner: feature.owner,
      project: feature.project,
      tags: feature.tags,
      neverStale: feature.neverStale,
      customFields: feature.customFields,
      jsonSchema: feature.jsonSchema,
      // valueType is intentionally excluded: it is immutable after feature creation
      // and is never written into a revision metadata envelope.
    }),
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

    // 1. Settings (metadata)
    if (draft.metadata) {
      const metadataRender = renderRevisionMetadata(
        current.metadata,
        draft.metadata,
      );
      if (metadataRender) {
        const metaBadges: DiffBadge[] = [];
        const pre = current.metadata;
        const post = draft.metadata;
        if (
          !isEqual(pre?.description, post.description) &&
          post.description !== undefined
        )
          metaBadges.push({
            label: "Edit description",
            action: "edit description",
          });
        if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined)
          metaBadges.push({ label: "Edit owner", action: "edit owner" });
        if (!isEqual(pre?.project, post.project) && post.project !== undefined)
          metaBadges.push({ label: "Edit project", action: "edit project" });
        if (!isEqual(pre?.tags, post.tags) && post.tags !== undefined)
          metaBadges.push({ label: "Edit tags", action: "edit tags" });
        if (
          !isEqual(pre?.neverStale, post.neverStale) &&
          post.neverStale !== undefined
        )
          metaBadges.push({
            label: "Edit stale setting",
            action: "edit stale setting",
          });
        if (
          !isEqual(pre?.customFields, post.customFields) &&
          post.customFields !== undefined
        )
          metaBadges.push({
            label: "Edit custom fields",
            action: "edit custom fields",
          });
        if (
          !isEqual(pre?.jsonSchema, post.jsonSchema) &&
          post.jsonSchema !== undefined
        )
          metaBadges.push({
            label: "Edit JSON schema",
            action: "edit json schema",
          });
        diffs.push({
          title: "Feature Settings",
          a: JSON.stringify(current.metadata, null, 2),
          b: JSON.stringify(draft.metadata, null, 2),
          customRender: metadataRender,
          badges:
            metaBadges.length > 0
              ? metaBadges
              : [{ label: "Edit settings", action: "edit settings" }],
        });
      }
    }

    // 2. Environment toggles (kill switches)
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

    // 3. Prerequisites (env-level then feature-level)
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
          badges: prerequisiteChangeBadges(
            currentPrereqs,
            draftPrereqs,
            "env prerequisite",
          ),
        });
      }
    });

    if (draft.prerequisites !== undefined) {
      const currentPrereqs = current.prerequisites || [];
      const draftPrereqs = draft.prerequisites;
      if (!isEqual(currentPrereqs, draftPrereqs)) {
        diffs.push({
          title: "Feature Prerequisites",
          a: JSON.stringify(currentPrereqs, null, 2),
          b: JSON.stringify(draftPrereqs, null, 2),
          customRender: renderPrerequisites(currentPrereqs, draftPrereqs),
          badges: prerequisiteChangeBadges(
            currentPrereqs,
            draftPrereqs,
            "prerequisite",
          ),
        });
      }
    }

    // 4. Default value
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

    // 5. Rules (per environment)
    const draftEnvironments = Object.keys(draft.rules || {});
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

    return diffs;
  }, [current, draft]);
}
