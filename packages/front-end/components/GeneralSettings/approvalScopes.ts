import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import isEqual from "lodash/isEqual";
import { getReviewSetting } from "shared/util";
import { getApprovalFlowRules } from "shared/enterprise";

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

// What this scope would resolve to with its own rule taken out of the stack —
// i.e. what each unset field falls back to. The all-projects scope is the base,
// so nothing sits above it to inherit from.
export function inheritedFlagRule(
  rules: RequireReview[],
  scope: string,
): RequireReview | undefined {
  if (!scope) return undefined;
  return getReviewSetting(withoutScope(rules, scope), {
    project: scopeProjects(scope)[0],
  });
}

export function inheritedSavedGroupRule(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration | undefined {
  if (!scope) return undefined;
  return getApprovalFlowRules(
    { savedGroups: withoutScope(rules, scope) },
    "saved-group",
    scopeProjects(scope),
  )[0];
}

// An override starts as a full copy of the base rule, so a project's form shows
// exactly what applies today and then diverges only where it is edited.
export function clonedFlagRule(
  rules: RequireReview[],
  scope: string,
): RequireReview {
  const own = ruleForScope(rules, scope);
  if (own) return own;
  const base = inheritedFlagRule(rules, scope);
  return base
    ? { ...base, projects: scopeProjects(scope) }
    : flagRuleDefaults(scope);
}

export function clonedSavedGroupRule(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration {
  const own = ruleForScope(rules, scope);
  if (own) return own;
  const base = inheritedSavedGroupRule(rules, scope);
  return base
    ? { ...base, projects: scopeProjects(scope) }
    : savedGroupRuleDefaults(scope);
}

// Whether this scope's rule says anything different from the base it was copied
// from. The selector is not part of the comparison — it is what names the scope.
export function differsFromBase<T extends { projects?: string[] }>(
  rule: T,
  base: T | undefined,
): boolean {
  if (!base) return false;
  const strip = (r: T) => {
    const { projects: _projects, ...rest } = r;
    return Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== null && v !== undefined),
    );
  };
  return !isEqual(strip(rule), strip(base));
}
