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

export type ApprovalFlowFamily = "saved-group" | "sdk-connection";

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

// Every override scope that already has a rule, in any family.
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

function inheritedApprovalFlowRule(
  family: ApprovalFlowFamily,
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration | undefined {
  if (!scope) return undefined;
  const others = withoutScope(rules, scope);
  return getApprovalFlowRules(
    family === "saved-group"
      ? { savedGroups: others }
      : { savedGroups: [], sdkConnections: others },
    family,
    scopeProjects(scope),
  )[0];
}

export const inheritedSavedGroupRule = (
  rules: ApprovalFlowConfiguration[],
  scope: string,
) => inheritedApprovalFlowRule("saved-group", rules, scope);

export const inheritedSdkConnectionRule = (
  rules: ApprovalFlowConfiguration[],
  scope: string,
) => inheritedApprovalFlowRule("sdk-connection", rules, scope);

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

function clonedApprovalFlowRule(
  family: ApprovalFlowFamily,
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration {
  const own = ruleForScope(rules, scope);
  if (own) return own;
  const base = inheritedApprovalFlowRule(family, rules, scope);
  return base
    ? { ...base, projects: scopeProjects(scope) }
    : savedGroupRuleDefaults(scope);
}

export const clonedSavedGroupRule = (
  rules: ApprovalFlowConfiguration[],
  scope: string,
) => clonedApprovalFlowRule("saved-group", rules, scope);

// A scope can hold several SDK Connection rules, one per environment set. The
// form shows one, so it shows an active one: its switch is on if any rule is.
export function clonedSdkConnectionRule(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration {
  const own = rulesForScope(rules, scope);
  return (
    own.find((r) => !!r.required) ??
    clonedApprovalFlowRule("sdk-connection", rules, scope)
  );
}

function rulesForScope<T extends Scoped>(rules: T[], scope: string): T[] {
  return rules.filter((r) => scopeKey(r.projects) === scope);
}

// Replaces all of the scope's rules with `next`, where its first rule stood.
function withScopeRules<T extends Scoped>(
  rules: T[],
  scope: string,
  next: T[],
): T[] {
  const i = rules.findIndex((r) => scopeKey(r.projects) === scope);
  if (i < 0) return [...rules, ...next];
  return rules.flatMap((r, idx) =>
    idx === i ? next : scopeKey(r.projects) === scope ? [] : [r],
  );
}

// An edit in the form applies to every rule in the scope. Environments are
// each rule's own, so an edit to them changes only the rule the form shows.
export function withSdkConnectionRuleEdited(
  rules: ApprovalFlowConfiguration[],
  scope: string,
  next: ApprovalFlowConfiguration,
): ApprovalFlowConfiguration[] {
  const own = rulesForScope(rules, scope);
  if (own.length < 2) return withRuleForScope(rules, scope, next);
  const shown = clonedSdkConnectionRule(rules, scope);
  const edited = own.includes(shown) ? shown : own[0];
  const keys = new Set([
    ...Object.keys(shown),
    ...Object.keys(next),
  ] as (keyof ApprovalFlowConfiguration)[]);
  const patch: Partial<ApprovalFlowConfiguration> = {};
  keys.forEach((key) => {
    if (key !== "projects" && !isEqual(shown[key], next[key])) {
      Object.assign(patch, { [key]: next[key] });
    }
  });
  const { environments, ...shared } = patch;
  return rules.map((r) => {
    if (scopeKey(r.projects) !== scope) return r;
    return {
      ...r,
      ...shared,
      ...(r === edited && "environments" in patch && { environments }),
    };
  });
}

// Back to what a fresh override would seed: every base rule, one-for-one.
export function withSdkConnectionScopeReset(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration[] {
  const others = withoutScope(rules, scope);
  return withScopeRules(
    rules,
    scope,
    rulesForScope(seededSdkConnectionRules(others, scope), scope),
  );
}

export function sdkConnectionScopeDiffersFromBase(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): boolean {
  const own = rulesForScope(rules, scope);
  if (!own.length || !inheritedSdkConnectionRule(rules, scope)) return false;
  const seeded = rulesForScope(
    withSdkConnectionScopeReset(rules, scope),
    scope,
  );
  if (own.length !== seeded.length) return true;
  return own.some((r, i) => differsFromBase(r, seeded[i]));
}

// A fresh override's SDK Connection rules. Base rules can each gate their own
// environments, and one combined copy keeps only the first rule's, so the
// override would drop review in the others: copy them one-for-one instead.
export function seededSdkConnectionRules(
  rules: ApprovalFlowConfiguration[],
  scope: string,
): ApprovalFlowConfiguration[] {
  if (!scope || ruleForScope(rules, scope)) return rules;
  const active = rules.filter((r) => !r.projects?.length && !!r.required);
  if (active.length < 2) {
    return withRuleForScope(
      rules,
      scope,
      clonedSdkConnectionRule(rules, scope),
    );
  }
  return [
    ...rules,
    ...active.map((r) => ({ ...r, projects: scopeProjects(scope) })),
  ];
}

// Re-points every rule in the scope, since a scope can hold several.
export function withScopeRetargeted<T extends Scoped>(
  rules: T[],
  scope: string,
  next: string[],
): T[] {
  return rules.map((r) =>
    scopeKey(r.projects) === scope ? { ...r, projects: next } : r,
  );
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

// A legacy boolean means "review required, everywhere". Read as `[]`, saving
// would write `requireReviewOn: false` and quietly turn review off org-wide.
export function flagRulesFromSettings(
  requireReviews: boolean | RequireReview[] | undefined,
): RequireReview[] {
  if (Array.isArray(requireReviews)) return requireReviews;
  if (!requireReviews) return [];
  return [{ ...flagRuleDefaults(ALL_PROJECTS_SCOPE), requireReviewOn: true }];
}
