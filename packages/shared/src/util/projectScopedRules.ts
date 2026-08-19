// Resolution shared by every project-scoped governance rule: a rule naming the
// project beats the all-projects rule, and unset fields inherit from it.
// Optional because rows written before a rule family gained its selector have
// no `projects` at all, and those must read as the all-projects layer.
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

// How to fold several rules that govern the same project into one. A combiner
// sees every rule's raw value, including the unset ones, because what "unset"
// means is the field's own business. Fields without a combiner take the first
// set value, which is only safe where such rules agree.
export type RuleCombiners<T> = Partial<{
  [K in keyof T]: (values: (T[K] | undefined)[]) => T[K];
}>;

// Order-independent on purpose: nothing about the outcome should depend on where
// a rule sits in the array.
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
    const set = raw.filter((v) => (v ?? null) !== null);
    if (!set.length) continue;
    const fold = combine[key];
    Object.assign(merged, { [key]: fold ? fold(raw) : set[0] });
  }
  Object.assign(merged, {
    projects: [...new Set(rules.flatMap((r) => r.projects ?? []))].sort(),
  });
  return merged;
}

// `inheritable` names the fields an override may leave unset. A rule's selector
// and its own on/off switch must never inherit, so they stay off that list.
export function resolveProjectScopedRule<T extends ProjectScopedRule>(
  rules: T[],
  project: string | undefined,
  inheritable: readonly (keyof T)[],
  combine: RuleCombiners<T> = {},
  // A rule whose own switch is off gates nothing, so it must not contribute its
  // scope to the fold — otherwise "review not required, all environments" would
  // widen the environments the other rules gate.
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
  // Only a project-specific winner has somewhere to inherit from. A base winner
  // is already the bottom layer, so it is returned as-is.
  if (!specificWinner || !baseWinner) return winner;
  const layers = [specificWinner, baseWinner];

  const merged: T = { ...winner };
  for (const field of inheritable) {
    // null counts as unset, so clearing a field on an override inherits it.
    const source = layers.find((l) => (l[field] ?? null) !== null);
    Object.assign(merged, { [field]: source ? source[field] : undefined });
  }
  return merged;
}

// Every project named by a rule, so callers can enumerate the overrides that
// exist without knowing the org's full project list.
export function projectsWithOwnRule<T extends ProjectScopedRule>(
  rules: T[],
): string[] {
  return [...new Set(rules.flatMap((r) => r.projects ?? []))];
}

// `null` is the API's "unset this field" signal; what gets stored simply omits
// it, so a cleared override reads as inherited rather than as an explicit null.
function dropUnsetFields<T extends object>(rule: T): T {
  return Object.fromEntries(
    Object.entries(rule).filter(([, value]) => value !== null),
  ) as T;
}

// Applied on the way in, so both rule families store cleared fields the same way.
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
