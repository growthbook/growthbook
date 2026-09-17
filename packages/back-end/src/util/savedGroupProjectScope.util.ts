import {
  findStoredRuleCounterpart,
  getRuleTargetingProjectIds,
  isSavedGroupAvailableForProjects,
  isMigrationSuffixedRuleId,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SavedGroupInterface } from "shared/types/saved-group";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

export type Group = Pick<
  SavedGroupInterface,
  "id" | "type" | "condition" | "projects"
>;
// Prerequisite conditions test the parent's value, not a user, so the SDK
// evaluates them without Saved Groups. Only rule targeting is scanned.
type Targeting = {
  condition?: string;
  savedGroups?: { ids: string[] }[];
};
export type Feature = Pick<
  FeatureInterface,
  "project" | "targetingProjects" | "targetingAllProjects" | "rules"
>;
export type ProjectScope = string[] | null;
export type ScopedRule = {
  rule: Feature["rules"][number];
  projects: ProjectScope;
};

// Parse operators, not substrings: IDs may also appear as ordinary targeting
// values. Covers nested logical operators and both positive/negative membership.
export function savedGroupIdsInTargeting(targeting: Targeting): Set<string> {
  const ids = new Set(targeting.savedGroups?.flatMap((s) => s.ids));
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$savedGroups") {
        for (const id of Array.isArray(child) ? child : [child]) {
          if (typeof id === "string") ids.add(id);
        }
      } else if (key === "$inGroup" || key === "$notInGroup") {
        if (typeof child === "string") ids.add(child);
      } else {
        visit(child);
      }
    }
  };
  if (targeting.condition) {
    try {
      visit(JSON.parse(targeting.condition));
    } catch {
      throw new BadRequestError("Invalid targeting condition JSON");
    }
  }
  return ids;
}

export function assertSavedGroupReferencesInScope(
  targeting: Targeting,
  projects: ProjectScope,
  groups: Map<string, Group>,
): void {
  if (projects?.length === 0) return;
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const group = groups.get(id);
    if (!group)
      throw new NotFoundError("A referenced Saved Group was not found.");
    if (!isSavedGroupAvailableForProjects(group, projects)) {
      throw new BadRequestError(
        "A referenced Saved Group is not available in every Project targeted by this Feature Flag. Share the Saved Group with those Projects or remove the reference.",
      );
    }
    if (group.type === "condition") {
      for (const nested of savedGroupIdsInTargeting(group)) visit(nested);
    }
  };
  for (const id of savedGroupIdsInTargeting(targeting)) visit(id);
}

export function scopedRules(feature: Feature): ScopedRule[] {
  return (feature.rules ?? []).map((rule) => ({
    rule,
    projects: getRuleTargetingProjectIds(feature, rule),
  }));
}

export function featureForSavedGroupValidation(
  feature: Feature,
  revision: Pick<FeatureRevisionInterface, "metadata" | "rules">,
): Feature {
  return {
    ...feature,
    ...revision.metadata,
    // Older snapshots omitted these fields when they were false/empty. They
    // must not inherit new live targeting and turn it into a prior exposure.
    targetingAllProjects: revision.metadata?.targetingAllProjects ?? false,
    targetingProjects: revision.metadata?.targetingProjects ?? [],
    rules: revision.rules,
  };
}

// Reserve exact identities first: added siblings cannot borrow the exemption
// of a rule that remains in place. Retired legacy siblings can merge, or split
// into disjoint subsets of their former environments, during v1 normalization.
export function savedGroupScopeRuleCounterparts(
  stored: Feature["rules"],
  proposed: Feature["rules"],
): Map<Feature["rules"][number], Feature["rules"][number][]> {
  type Rule = Feature["rules"][number];
  const matches = new Map<Rule, Rule[]>();
  const storedById = new Map(stored.filter((r) => r.id).map((r) => [r.id, r]));
  const proposedIdCounts = new Map<string, number>();
  for (const rule of proposed) {
    proposedIdCounts.set(rule.id, (proposedIdCounts.get(rule.id) ?? 0) + 1);
  }
  for (const rule of proposed) {
    const exact = storedById.get(rule.id);
    if (exact && proposedIdCounts.get(rule.id) === 1)
      matches.set(rule, [exact]);
  }
  const reserved = new Set([...matches.values()].flat());
  const remaining = stored.filter((r) => !reserved.has(r));
  const candidates = new Map<Rule, Rule[]>();
  const uses = new Map<Rule, Rule[]>();
  for (const rule of proposed) {
    if (matches.has(rule)) continue;
    const eligible = remaining.filter((previous) =>
      findStoredRuleCounterpart([previous], rule),
    );
    candidates.set(rule, eligible);
    for (const previous of eligible) {
      uses.set(previous, [...(uses.get(previous) ?? []), rule]);
    }
  }
  const unambiguous = new Set<Rule>();
  for (const [previous, replacements] of uses) {
    const seenEnvironments = new Set<string>();
    const isPartition = replacements.every(
      (rule) =>
        isMigrationSuffixedRuleId(rule.id) &&
        !rule.allEnvironments &&
        !!rule.environments?.length &&
        rule.environments.every((env) => {
          if (seenEnvironments.has(env)) return false;
          seenEnvironments.add(env);
          return (
            previous.allEnvironments || previous.environments?.includes(env)
          );
        }),
    );
    if (replacements.length === 1 || isPartition) unambiguous.add(previous);
  }
  for (const [rule, eligible] of candidates) {
    if (
      eligible.length &&
      eligible.every((previous) => unambiguous.has(previous))
    ) {
      matches.set(rule, eligible);
    }
  }
  return matches;
}

// Compare the full consumer DAG before and after a group change. Track each
// denied Project separately so an existing violation in one Project cannot
// hide a new violation in another. Unrelated legacy violations allow repair.
export function savedGroupScopeChangeBreaksTargeting(
  targeting: Targeting,
  projects: ProjectScope,
  proposed: Group,
  groups: Map<string, Group>,
  previous?: Group,
): boolean {
  // For All Projects, compare the explicit scopes as well as an outside
  // Project (null). The outside marker catches newly reached scoped groups;
  // explicit Projects catch narrowing an already-grandfathered scoped group.
  const projectsToCheck = projects ?? [
    ...new Set([...(previous?.projects ?? []), ...(proposed.projects ?? [])]),
    null,
  ];
  const violations = (replacement?: Group): Set<string> => {
    const denied = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const group = id === proposed.id ? replacement : groups.get(id);
      if (!group) return; // Existence is validated by the targeting validators.
      if (group.projects?.length) {
        for (const project of projectsToCheck) {
          if (project === null || !group.projects.includes(project)) {
            denied.add(JSON.stringify([id, project]));
          }
        }
      }
      if (group.type === "condition") {
        for (const nested of savedGroupIdsInTargeting(group)) visit(nested);
      }
    };
    for (const id of savedGroupIdsInTargeting(targeting)) visit(id);
    return denied;
  };
  const before = violations(previous);
  return [...violations(proposed)].some((key) => !before.has(key));
}
