import { useMemo, ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { RevisionMetadata, stripUnknownRuleFields } from "shared/validators";
import type { MergeResultChanges } from "shared/util";
import {
  renderFeatureDefaultValue,
  renderFeatureRules,
  normalizeFeatureRules,
  featureRuleChangeBadges,
  renderEnvironmentToggles,
  type DiffRenderMode,
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
    targetingProjects: m.targetingProjects ?? [],
    targetingAllProjects: m.targetingAllProjects ?? false,
  };
}

// Bookkeeping fields the snapshot records but that aren't user-editable revision
// settings and aren't rendered by the human diff — including them in the raw
// JSON diff only produces phantom churn when an older snapshot predates them.
const NON_SETTING_METADATA_FIELDS = new Set(["valueType", "baseConfig"]);

// Canonical JSON for the raw "Feature Settings" diff: keys sorted (so a differing
// snapshot key order doesn't read as churn) and bookkeeping fields dropped, so
// the raw view reflects the same real changes as the formatted view.
function metadataDiffJson(m: RevisionMetadata | undefined): string {
  if (!m) return "";
  const canonical: Record<string, unknown> = {};
  Object.keys(m)
    .filter((k) => !NON_SETTING_METADATA_FIELDS.has(k))
    .sort()
    .forEach((k) => {
      canonical[k] = (m as Record<string, unknown>)[k];
    });
  return JSON.stringify(canonical, null, 2);
}

// Backfill envelope fields from `fallback` (typically the parent feature's
// current state) when the revision doesn't store them. Pre-snapshot legacy
// revisions only persisted defaultValue/rules; comparing one against a freshly
// created draft (which now snapshots the full envelope) would otherwise
// produce phantom "added" diffs for metadata, env toggles, prerequisites, and
// holdout. Used by surfaces that diff a raw revision against the live feature
// (compare modal, review-and-publish conflict fallback).
export const revisionToFeatureRevisionDiffInput = (
  r: FeatureRevisionInterface,
  fallback?: FeatureRevisionDiffInput,
): FeatureRevisionDiffInput => {
  return {
    defaultValue: r.defaultValue,
    rules: Array.isArray(r.rules) ? r.rules : [],
    environmentsEnabled: r.environmentsEnabled ?? fallback?.environmentsEnabled,
    prerequisites: r.prerequisites ?? fallback?.prerequisites,
    archived: r.archived ?? fallback?.archived,
    holdout: r.holdout !== undefined ? r.holdout : (fallback?.holdout ?? null),
    metadata: normalizeRevisionMetadata(r.metadata) ?? fallback?.metadata,
    rampActions: r.rampActions ?? undefined,
  };
};

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
      targetingProjects: feature.targetingProjects,
      targetingAllProjects: feature.targetingAllProjects,
      neverStale: feature.neverStale,
      customFields: feature.customFields,
      jsonSchema: feature.jsonSchema,
      // Was excluded as immutable, which a managed flag broke: it re-types
      // through the draft's `metadata.valueType` and only applies on publish.
      // Without the live type here a re-type reads as "unset -> json", or
      // vanishes entirely when the draft inherits this envelope wholesale.
      valueType: feature.valueType,
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
  // Stable machine identity for this section, independent of the display
  // title. Uses the same vocabulary as granular merge-conflict keys
  // (`rules`, `defaultValue`, `environmentsEnabled.<env>`, ...) plus
  // `rampAction.<id>` / `rampSchedule.<id>` for supplemental entities.
  // Used by diff comment references (see diffCommentRefs.ts).
  key?: string;
  a: string;
  b: string;
  customRender?: ReactNode;
  // Rendered inline next to the title in the customRender section heading
  // (e.g. a "[pending publish]" badge for ramp-schedule diffs).
  titleSuffix?: ReactNode;
  badges?: DiffBadge[];
  // Marks a diff that represents a separate top-level entity (e.g. a ramp
  // schedule / ramp action) rather than a field of the feature revision itself.
  // In the "Raw JSON" view these render as their own per-entity diffs alongside
  // the single whole-revision blob.
  supplemental?: boolean;
  // For supplemental diffs: the underlying entity's own name and kind (e.g.
  // "Spring rollout" / "ramp-schedule"). Used by the JSON copy formats, which
  // emit a { name, type } pair per entity — `title` is a display label.
  entityName?: string;
  entityType?: string;
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
  renderMode = "feature",
}: {
  current: FeatureRevisionDiffInput;
  draft: FeatureRevisionDiffInput;
  // "experiment": the rule is the subject and the surface already names the
  // flag, so the feature framing around it is dropped. See DiffRenderMode.
  renderMode?: DiffRenderMode;
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
        key: "archived",
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
          (pre?.neverStale ?? false) !== (post.neverStale ?? false) &&
          post.neverStale !== undefined
        )
          metaBadges.push({
            label: "Edit stale setting",
            action: "edit stale setting",
          });
        if (
          !isEqual(pre?.customFields ?? null, post.customFields ?? null) &&
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
          key: "metadata",
          title: "Feature Settings",
          a: metadataDiffJson(current.metadata),
          b: metadataDiffJson(draft.metadata),
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
    const toggled = Object.keys(draft.environmentsEnabled || {})
      .map((envId) => ({
        envId,
        from: inheritedCurrent[envId] ?? false,
        to: inheritedDraft[envId] ?? false,
      }))
      .filter(({ from, to }) => from !== to);
    // One section for every toggle, not one per environment: an org with
    // twenty environments would otherwise bury the rest of the diff.
    if (toggled.length) {
      const asMap = (side: "from" | "to") =>
        Object.fromEntries(toggled.map((t) => [t.envId, t[side]]));
      // A managed flag is born with every environment off, so its first draft
      // turning them on is the flag arriving, not a change to one.
      const arriving =
        renderMode === "experiment" && !(current.rules ?? []).length;
      diffs.push({
        key: "environmentsEnabled",
        // The rows name the environments, so the heading doesn't repeat them,
        // and "toggle" adds nothing a check/cross doesn't already say.
        title: toggled.length === 1 ? "Environment" : "Environments",
        a: JSON.stringify(asMap("from"), null, 2),
        b: JSON.stringify(asMap("to"), null, 2),
        customRender: renderEnvironmentToggles(toggled, {
          endStateOnly: arriving,
        }),
        badges: toggled.map(({ envId, to }) => ({
          label: `Toggled ${envId} ${to ? "on" : "off"}`,
          action: `toggle environment ${envId}`,
        })),
      });
    }

    // 3. Prerequisites (feature-level)
    if (draft.prerequisites !== undefined) {
      const currentPrereqs = current.prerequisites || [];
      const draftPrereqs = draft.prerequisites;
      if (!isEqual(currentPrereqs, draftPrereqs)) {
        diffs.push({
          key: "prerequisites",
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
          key: "holdout",
          title: "Holdout",
          a: JSON.stringify(currentHoldout, null, 2),
          b: JSON.stringify(draftHoldout, null, 2),
          customRender: renderFeatureHoldoutSection(pre, post),
          badges: getFeatureHoldoutBadges(pre, post),
        });
      }
    }

    // 5. Default value. A managed flag's default IS its control value, which
    // the rule below states — the section would only say it twice.
    const currentDefault = current.defaultValue ?? "";
    const draftDefault = draft.defaultValue ?? "";
    const aValue = parseDefaultValue(currentDefault);
    const bValue = parseDefaultValue(draftDefault);
    if (!isEqual(aValue, bValue) && renderMode !== "experiment") {
      diffs.push({
        key: "defaultValue",
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
    // Through the rule's own schema: a rule that picked up fields its type
    // never declared (the rule form used to send widget-only ones) would
    // otherwise diff as "Hash Version: unset -> 2" on every later revision,
    // reporting a change nobody made.
    const draftRulesArr = (Array.isArray(draft.rules) ? draft.rules : []).map(
      stripUnknownRuleFields,
    );
    const currentRulesArr = (
      Array.isArray(current.rules) ? current.rules : []
    ).map(stripUnknownRuleFields);
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
        key: "rules",
        // The experiment surface has one rule and already names it, so the
        // card carries the values without a "Rules" heading over them.
        title: renderMode === "experiment" ? "" : "Rules",
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
          renderMode,
        }),
        badges: featureRuleChangeBadges(currentRulesArr, draftRulesArr),
      });
    }

    return diffs;
  }, [current, draft, orgEnvs, holdoutsMap, renderMode]);
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
