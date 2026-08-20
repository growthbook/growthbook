import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import isEqual from "lodash/isEqual";
import { getReviewSetting } from "shared/util";
import { getApprovalFlowRules } from "shared/enterprise";

// A scope is a rule's selector flattened: "" = all projects, else sorted ids
// comma-joined. Keying on the whole selector keeps multi-project rules visible.
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

// What the scope resolves to with its own rule removed. The base inherits nothing.
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

// An override starts as a full copy, so the form shows what applies today.
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

// Whether the rule differs from its base. The selector names the scope, so it
// is not compared.
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

// A legacy boolean setting means "review required, everywhere" with no rule to
// hang policy off. Surfacing it as a real rule keeps the form honest — read as
// `[]`, saving the form would write `requireReviewOn: false` and quietly turn
// review off for the whole org.
export function flagRulesFromSettings(
  requireReviews: boolean | RequireReview[] | undefined,
): RequireReview[] {
  if (Array.isArray(requireReviews)) return requireReviews;
  if (!requireReviews) return [];
  return [{ ...flagRuleDefaults(ALL_PROJECTS_SCOPE), requireReviewOn: true }];
}
