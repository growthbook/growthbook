import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";

// A scope is a rule's selector, flattened: "" is all projects, otherwise the
// rule's project ids sorted and comma-joined. Keying on the whole selector (not
// a single id) means an API-authored rule naming two projects still gets a tab
// rather than disappearing from the UI.
export const ALL_PROJECTS_SCOPE = "";

export const scopeKey = (projects: string[] | undefined): string =>
  [...(projects ?? [])].sort().join(",");

export const scopeProjects = (scope: string): string[] =>
  scope ? scope.split(",") : [];

export const flagRuleDefaults = (scope: string): RequireReview => ({
  requireReviewOn: false,
  resetReviewOnChange: false,
  environments: [],
  projects: scopeProjects(scope),
});

export const savedGroupRuleDefaults = (
  scope: string,
): ApprovalFlowConfiguration => ({
  required: false,
  projects: scopeProjects(scope),
});

type Scoped = { projects?: string[] };

export function ruleForScope<T extends Scoped>(
  rules: T[],
  scope: string,
): T | undefined {
  return rules.find((r) => scopeKey(r.projects) === scope);
}

export function withRuleForScope<T extends Scoped>(
  rules: T[],
  scope: string,
  next: T,
): T[] {
  const i = rules.findIndex((r) => scopeKey(r.projects) === scope);
  return i >= 0
    ? rules.map((r, idx) => (idx === i ? next : r))
    : [...rules, next];
}

export function withoutScope<T extends Scoped>(rules: T[], scope: string): T[] {
  return rules.filter((r) => scopeKey(r.projects) !== scope);
}

// Every override scope that already has a rule, in either family.
export function overrideScopes(families: Scoped[][]): string[] {
  const scopes = new Set<string>();
  families.forEach((rules) =>
    rules.forEach((r) => {
      const key = scopeKey(r.projects);
      if (key) scopes.add(key);
    }),
  );
  return [...scopes];
}
