// Resolution shared by every project-scoped governance rule: a rule naming the
// project beats the all-projects rule, and unset fields inherit from it.
// Optional because rows written before a rule family gained its selector have
// no `projects` at all, and those must read as the all-projects layer.
export type ProjectScopedRule = { projects?: string[] };

function layersFor<T extends ProjectScopedRule>(
  rules: T[],
  project: string | undefined,
): T[] {
  const specific = project
    ? rules.filter((r) => (r.projects ?? []).includes(project))
    : [];
  const base = rules.filter((r) => !r.projects?.length);
  return [...specific, ...base];
}

// `inheritable` names the fields an override may leave unset. A rule's selector
// and its own on/off switch must never inherit, so they stay off that list.
export function resolveProjectScopedRule<T extends ProjectScopedRule>(
  rules: T[],
  project: string | undefined,
  inheritable: readonly (keyof T)[],
): T | undefined {
  const layers = layersFor(rules, project);
  const winner = layers[0];
  if (!winner) return undefined;
  if (layers.length === 1) return winner;

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
