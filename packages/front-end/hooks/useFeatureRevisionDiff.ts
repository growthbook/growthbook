import { useMemo, ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { RevisionMetadata } from "shared/validators";
import type { MergeResultChanges } from "shared/util";
import {
  renderFeatureDefaultValue,
  renderFeatureRules,
  normalizeFeatureRules,
  featureRuleChangeBadges,
  renderEnvironmentsEnabled,
  renderPrerequisites,
  renderRevisionMetadata,
  prerequisiteChangeBadges,
  renderFeatureHoldoutSection,
  getFeatureHoldoutBadges,
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
  for (const [envId, env] of Object.entries(
    feature.environmentSettings || {},
  )) {
    environmentsEnabled[envId] = env.enabled;
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
    prerequisites: feature.prerequisites,
    holdout: feature.holdout ?? null,
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
  | "prerequisites"
  | "metadata"
  | "holdout"
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
        // When the older revision didn't explicitly set this env, infer the
        // previous state as the opposite of the new state. This is guaranteed
        // correct here because currentVal !== draftVal already filtered out
        // no-ops — if draftVal is false the env must have been true before,
        // and vice versa.
        const resolvedCurrentVal =
          currentVal !== undefined ? currentVal : !draftVal;
        const direction = draftVal ? "on" : "off";
        diffs.push({
          title: `Environment Toggle - ${envId}`,
          a: String(resolvedCurrentVal),
          b: draftVal !== undefined ? String(draftVal) : "",
          customRender: renderEnvironmentsEnabled(
            envId,
            resolvedCurrentVal,
            draftVal,
          ),
          badges: [
            {
              label: `Toggled ${envId} ${direction}`,
              action: `toggle environment ${envId}`,
            },
          ],
        });
      }
    });

    // 3. Prerequisites (feature-level)
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

    // 4. Holdout
    if ("holdout" in draft) {
      const currentHoldout = current.holdout ?? null;
      const draftHoldout = draft.holdout ?? null;
      if (!isEqual(currentHoldout, draftHoldout)) {
        const pre = { holdout: currentHoldout ?? undefined };
        const post = { holdout: draftHoldout ?? undefined };
        diffs.push({
          title: "Holdout",
          a: JSON.stringify(currentHoldout, null, 2),
          b: JSON.stringify(draftHoldout, null, 2),
          customRender: renderFeatureHoldoutSection(pre, post),
          badges: getFeatureHoldoutBadges(pre, post),
        });
      }
    }

    // 5. Default value
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

    // 6. Rules (per environment)
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

/**
 * Converts a successful `autoMerge` result into a `FeatureRevisionDiffInput`
 * for `useFeatureRevisionDiff`.  Falls back to `current` for fields not
 * present in the merge result (i.e. fields that were not part of the draft).
 * Fields that carry change semantics through their *presence* (holdout, envs,
 * prerequisites, metadata) are only included when they appear in `result`.
 */
export function mergeResultToDiffInput(
  result: MergeResultChanges,
  current: FeatureRevisionDiffInput,
): FeatureRevisionDiffInput {
  return {
    defaultValue: result.defaultValue ?? current.defaultValue,
    rules: result.rules ?? current.rules,
    ...(result.environmentsEnabled !== undefined
      ? { environmentsEnabled: result.environmentsEnabled }
      : {}),
    ...(result.prerequisites !== undefined
      ? { prerequisites: result.prerequisites }
      : {}),
    ...("holdout" in result ? { holdout: result.holdout } : {}),
    ...(result.metadata !== undefined
      ? {
          metadata: {
            ...current.metadata,
            ...result.metadata,
          },
        }
      : {}),
  };
}
