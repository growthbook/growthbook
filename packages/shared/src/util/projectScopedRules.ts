// A rule naming the project beats the all-projects rule; unset fields inherit.
// Optional: rows predating the selector must read as the all-projects layer.
export type ProjectScopedRule = { projects?: string[] };

function matchingLayers<T extends ProjectScopedRule>(
  rules: T[],
  project: string | undefined,
): { specific: T[]; base: T[] } {
  return {
    specific: project
      ? rules.filter((r) => (r.projects ?? []).includes(project))
      : [],
    base: rules.filter((r) => !r.projects?.length),
  };
}

// Folds several rules governing one project. A combiner sees the unset values
// too, since what "unset" means is the field's own business.
export type RuleCombiners<T> = Partial<{
  [K in keyof T]: (values: (T[K] | undefined)[]) => T[K];
}>;

// Order-independent: the outcome must not depend on position in the array.
function combineRules<T extends ProjectScopedRule>(
  rules: T[],
  combine: RuleCombiners<T>,
): T {
  const merged: T = { ...rules[0] };
  const keys = new Set<keyof T>(
    rules.flatMap((r) => Object.keys(r) as (keyof T)[]),
  );
  for (const key of keys) {
    const raw = rules.map((r) => r[key]);
    const set = raw.filter((v) => v !== undefined);
    if (!set.length) continue;
    const fold = combine[key];
    Object.assign(merged, { [key]: fold ? fold(raw) : set[0] });
  }
  Object.assign(merged, {
    projects: [...new Set(rules.flatMap((r) => r.projects ?? []))].sort(),
  });
  return merged;
}

// `inheritable` excludes the selector and the rule's own switch.
export function resolveProjectScopedRule<T extends ProjectScopedRule>(
  rules: T[],
  project: string | undefined,
  inheritable: readonly (keyof T)[],
  combine: RuleCombiners<T> = {},
  // A rule whose switch is off gates nothing, so its scope must not widen the fold.
  isActive?: (rule: T) => boolean,
): T | undefined {
  const { specific, base } = matchingLayers(rules, project);
  const fold = (group: T[]): T | undefined => {
    if (!group.length) return undefined;
    const active = isActive ? group.filter(isActive) : group;
    if (!active.length) return group[0];
    return active.length > 1 ? combineRules(active, combine) : active[0];
  };
  const specificWinner = fold(specific);
  const baseWinner = fold(base);
  const winner = specificWinner ?? baseWinner;
  if (!winner) return undefined;
  // A base winner is already the bottom layer; only a specific one inherits.
  if (!specificWinner || !baseWinner) return winner;
  const layers = [specificWinner, baseWinner];

  const merged: T = { ...winner };
  for (const field of inheritable) {
    const source = layers.find((l) => l[field] !== undefined);
    Object.assign(merged, { [field]: source ? source[field] : undefined });
  }
  return merged;
}

// Enumerate override projects without needing the org's full project list.
export function projectsWithOwnRule<T extends ProjectScopedRule>(
  rules: T[],
): string[] {
  return [...new Set(rules.flatMap((r) => r.projects ?? []))];
}

// Absence is the only "unset", so a caller sending null gets the field dropped
// rather than storing a second way to say the same thing.
function dropUnsetFields<T extends object>(rule: T): T {
  return Object.fromEntries(
    Object.entries(rule).filter(([, value]) => value !== null),
  ) as T;
}

// Applied on the way in, so both rule families store clears the same way.
export function normalizeApprovalRuleSettings<
  T extends {
    requireReviews?: boolean | ProjectScopedRule[];
    approvalFlows?: { savedGroups?: ProjectScopedRule[] };
  },
>(settings: T): T {
  const next: T = { ...settings };
  if (Array.isArray(next.requireReviews)) {
    next.requireReviews = next.requireReviews.map(dropUnsetFields);
  }
  if (next.approvalFlows?.savedGroups) {
    next.approvalFlows = {
      ...next.approvalFlows,
      savedGroups: next.approvalFlows.savedGroups.map(dropUnsetFields),
    };
  }
  return next;
}
