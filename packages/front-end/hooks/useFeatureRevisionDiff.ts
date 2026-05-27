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
  renderFeatureArchived,
} from "@/components/Features/FeatureDiffRenders";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { useEnvironments } from "@/services/features";
import { useHoldouts, holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";

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
    rules: feature.rules ?? [],
    environmentsEnabled,
    prerequisites: feature.prerequisites,
    archived: feature.archived ?? false,
    holdout: feature.holdout ?? null,
    rampActions: undefined,
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
  | "archived"
  | "metadata"
  | "holdout"
> & {
  // Optional pending ramp-schedule actions on the draft side. When set,
  // rule diffs annotate affected rules with a "Pending Ramp Schedule" block.
  rampActions?: FeatureRevisionInterface["rampActions"];
};

export type FeatureRevisionDiff = {
  title: string;
  a: string;
  b: string;
  customRender?: ReactNode;
  // Rendered inline next to the title in the customRender section heading
  // (e.g. a "[pending publish]" badge for ramp-schedule diffs).
  titleSuffix?: ReactNode;
  badges?: DiffBadge[];
};

// Mirrors backend `applyEnvironmentInheritance`: fill missing env entries by
// walking each env's parent chain. Avoids phantom toggle diffs on inheriting
// envs that have no explicit entry on either side.
function fillEnabledByInheritance(
  enabled: Record<string, boolean> | undefined,
  envs: { id: string; parent?: string }[],
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...(enabled || {}) };
  const parentOf = new Map<string, string | undefined>();
  for (const e of envs) parentOf.set(e.id, e.parent);
  for (const e of envs) {
    if (e.id in out) continue;
    let ancestor = parentOf.get(e.id);
    const visited = new Set<string>([e.id]);
    while (ancestor && !(ancestor in out)) {
      if (visited.has(ancestor)) {
        ancestor = undefined;
        break;
      }
      visited.add(ancestor);
      ancestor = parentOf.get(ancestor);
    }
    if (ancestor) out[e.id] = out[ancestor];
  }
  return out;
}

export function useFeatureRevisionDiff({
  current,
  draft,
}: {
  current: FeatureRevisionDiffInput;
  draft: FeatureRevisionDiffInput;
}): FeatureRevisionDiff[] {
  const orgEnvs = useEnvironments();
  const { holdoutsMap } = useHoldouts();
  return useMemo(() => {
    const diffs: FeatureRevisionDiff[] = [];

    // 0. Archive status — a top-level revision field (not part of the metadata
    // envelope), so it needs its own section. renderFeatureArchived returns null
    // when unchanged (treating undefined as false), so it doubles as the guard —
    // no separate change check needed.
    const archivedRender = renderFeatureArchived(
      current.archived,
      draft.archived,
    );
    if (archivedRender) {
      diffs.push({
        title: "Archive status",
        a: (current.archived ?? false) ? "archived" : "active",
        b: draft.archived ? "archived" : "active",
        customRender: archivedRender,
        badges: [
          {
            label: draft.archived ? "Archived" : "Unarchived",
            action: "archive",
          },
        ],
      });
    }

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

    // 2. Environment toggles (kill switches). Apply inheritance to both sides
    // so a missing entry compares against its ancestor's value (avoids phantom
    // "disabled → enabled" diffs). Orphan envs fall back to `false`.
    const inheritedCurrent = fillEnabledByInheritance(
      current.environmentsEnabled,
      orgEnvs,
    );
    const inheritedDraft = fillEnabledByInheritance(
      draft.environmentsEnabled,
      orgEnvs,
    );
    const draftEnabledEnvs = Object.keys(draft.environmentsEnabled || {});
    draftEnabledEnvs.forEach((envId) => {
      const currentVal = inheritedCurrent[envId] ?? false;
      const draftVal = inheritedDraft[envId] ?? false;
      if (currentVal !== draftVal) {
        const direction = draftVal ? "on" : "off";
        diffs.push({
          title: `Environment Toggle - ${envId}`,
          a: String(currentVal),
          b: String(draftVal),
          customRender: renderEnvironmentsEnabled(currentVal, draftVal),
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

    // 6. Rules — single flat diff, NOT bucketed by environment.
    //
    // Post-unification `rules` is a `FeatureRule[]` whose members carry their
    // own env scope. Rule cards render the scope inline (see `RuleEnvScope`),
    // so a single rules section captures every change (adds, removes,
    // modifications, reorderings, and scope flips) including rules whose
    // footprint is empty (`environments: []`, pending) or universal
    // (`allEnvironments: true`) — all of which were invisible in the old
    // per-env projection layout.
    const draftRulesArr = Array.isArray(draft.rules) ? draft.rules : [];
    const currentRulesArr = Array.isArray(current.rules) ? current.rules : [];
    const draftRampActions = draft.rampActions ?? undefined;
    // Force the Rules section to render when an unchanged rule has a pending
    // ramp create action queued — without this, a draft whose only change is
    // "add ramp schedule to an existing rule" wouldn't surface in the diff.
    const hasPendingRampOnUnchangedRule =
      Array.isArray(draftRampActions) &&
      draftRampActions.some(
        (a) =>
          a.mode === "create" &&
          draftRulesArr.some((r) => r.id === a.ruleId) &&
          currentRulesArr.some((r) => r.id === a.ruleId),
      );
    if (
      !isEqual(currentRulesArr, draftRulesArr) ||
      hasPendingRampOnUnchangedRule
    ) {
      diffs.push({
        title: "Rules",
        a: JSON.stringify(normalizeFeatureRules(currentRulesArr), null, 2),
        b: JSON.stringify(normalizeFeatureRules(draftRulesArr), null, 2),
        customRender: renderFeatureRules(currentRulesArr, draftRulesArr, {
          pendingRampActions: draftRampActions,
          // Match Rule.tsx numbering: the holdout occupies slot #1 only when
          // it's actually enabled in some env; a feature can carry a holdout
          // reference whose holdout is disabled everywhere, in which case the
          // rules list shows Rule #1, #2, … with no holdout row.
          preHasHoldout: holdoutOccupiesRuleSlot(current.holdout, holdoutsMap),
          postHasHoldout: holdoutOccupiesRuleSlot(draft.holdout, holdoutsMap),
        }),
        badges: featureRuleChangeBadges(currentRulesArr, draftRulesArr),
      });
    }

    return diffs;
  }, [current, draft, orgEnvs, holdoutsMap]);
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
    ...(result.archived !== undefined ? { archived: result.archived } : {}),
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
