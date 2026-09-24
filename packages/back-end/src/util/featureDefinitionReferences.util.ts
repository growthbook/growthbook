import {
  forEachSavedGroupIdInCondition,
  MAX_SAVED_GROUP_DEPTH,
} from "shared/sdk-versioning";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { ExperimentInterface } from "shared/types/experiment";
import type { SavedGroupInterface } from "shared/types/saved-group";

export type FeatureDefinitionSources = {
  features: Pick<FeatureInterface, "rules" | "prerequisites">[];
  // Revisions whose rules are compiled alongside the feature (`withRevisions`).
  revisions?: Pick<FeatureRevisionInterface, "rules">[];
  // `experiment-ref` rules take their targeting from the experiment's phase.
  experiments?: Iterable<Pick<ExperimentInterface, "phases">>;
};

// A rule's `savedGroups` entry spends one level before nested expansion starts
// counting, so the deepest group a definition reads sits one past the expansion
// depth. One spare round on top of that.
const MAX_SAVED_GROUP_LOAD_ROUNDS = MAX_SAVED_GROUP_DEPTH + 2;

function rulesOf({
  features,
  revisions,
}: Pick<FeatureDefinitionSources, "features" | "revisions">): FeatureRule[] {
  return [
    ...features.flatMap((f) => f.rules ?? []),
    ...(revisions ?? []).flatMap((r) =>
      Array.isArray(r.rules) ? r.rules : [],
    ),
  ];
}

// Stored data predates validation in places; anything that is not a string id
// is skipped, as the lookups it would have fed simply miss.
function addId(ids: Set<string>, id: unknown) {
  if (typeof id === "string" && id) ids.add(id);
}

function addConditionIds(ids: Set<string>, condition: unknown) {
  if (typeof condition !== "string" || !condition) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(condition);
  } catch {
    // A malformed condition is skipped when the definition is built, too.
    return;
  }
  forEachSavedGroupIdInCondition(parsed, (id) => addId(ids, id));
}

function addTargetingIds(
  ids: Set<string>,
  targeting: { condition?: unknown; savedGroups?: unknown } | null | undefined,
) {
  if (!targeting) return;
  addConditionIds(ids, targeting.condition);
  if (!Array.isArray(targeting.savedGroups)) return;
  for (const entry of targeting.savedGroups) {
    if (Array.isArray(entry?.ids)) {
      entry.ids.forEach((id: unknown) => addId(ids, id));
    }
  }
}

// Every Saved Group id these features' definitions can look up directly. A
// superset on purpose: a missing id silently drops targeting.
export function getSavedGroupIdsForFeatureDefinitions(
  sources: FeatureDefinitionSources,
): string[] {
  const ids = new Set<string>();

  for (const feature of sources.features) {
    for (const p of feature.prerequisites ?? []) {
      addConditionIds(ids, p.condition);
    }
  }
  for (const rule of rulesOf(sources)) {
    addTargetingIds(ids, rule);
    for (const p of rule.prerequisites ?? []) {
      addConditionIds(ids, p.condition);
    }
  }
  for (const experiment of sources.experiments ?? []) {
    for (const phase of experiment.phases ?? []) {
      addTargetingIds(ids, phase);
      for (const p of phase?.prerequisites ?? []) {
        addConditionIds(ids, p.condition);
      }
    }
  }

  return [...ids];
}

export function getSafeRolloutIdsForFeatureDefinitions(
  sources: Pick<FeatureDefinitionSources, "features" | "revisions">,
): string[] {
  const ids = new Set<string>();
  for (const rule of rulesOf(sources)) {
    if (rule.type === "safe-rollout") addId(ids, rule.safeRolloutId);
  }
  return [...ids];
}

// Loads the given Saved Groups plus any they reach through condition groups,
// one query per nesting level.
export async function loadSavedGroupsWithNested<
  T extends Pick<SavedGroupInterface, "id" | "type" | "condition">,
>(ids: string[], loadByIds: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const requested = new Set<string>();
  const loaded: T[] = [];
  let wanted = [...new Set(ids)];

  for (
    let round = 0;
    wanted.length && round < MAX_SAVED_GROUP_LOAD_ROUNDS;
    round++
  ) {
    wanted.forEach((id) => requested.add(id));
    const groups = await loadByIds(wanted);
    loaded.push(...groups);

    const next = new Set<string>();
    for (const group of groups) {
      // Expansion treats anything that is not an ID list as a condition group.
      if (group.type === "list") continue;
      addConditionIds(next, group.condition);
    }
    wanted = [...next].filter((id) => !requested.has(id));
  }

  return loaded;
}
