import { describe, expect, it } from "vitest";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import {
  ALL_PROJECTS_SCOPE,
  inheritedFlagRule,
  inheritedSavedGroupRule,
  ownFlagRule,
  ownSavedGroupRule,
  overrideScopes,
  ruleForScope,
  scopeKey,
  scopeProjects,
  withRuleForScope,
  withoutScope,
} from "@/components/GeneralSettings/approvalScopes";

const rule = (projects?: string[]): RequireReview =>
  ({
    requireReviewOn: true,
    resetReviewOnChange: false,
    environments: [],
    ...(projects ? { projects } : {}),
  }) as RequireReview;

describe("approval scope keys", () => {
  it("orders projects so the same selector always keys the same", () => {
    expect(scopeKey(["prj_b", "prj_a"])).toBe(scopeKey(["prj_a", "prj_b"]));
    expect(scopeProjects(scopeKey(["prj_b", "prj_a"]))).toEqual([
      "prj_a",
      "prj_b",
    ]);
  });

  // Rows written before the selector existed must read as the all-projects rule.
  it("treats a missing projects field as the all-projects scope", () => {
    expect(scopeKey(undefined)).toBe(ALL_PROJECTS_SCOPE);
    expect(ruleForScope([rule()], ALL_PROJECTS_SCOPE)).toBeDefined();
  });

  it("finds the rule whose selector matches exactly", () => {
    const rules = [rule([]), rule(["prj_a"]), rule(["prj_a", "prj_b"])];

    expect(ruleForScope(rules, "prj_a")?.projects).toEqual(["prj_a"]);
    expect(ruleForScope(rules, "prj_a,prj_b")?.projects).toEqual([
      "prj_a",
      "prj_b",
    ]);
    expect(ruleForScope(rules, "prj_c")).toBeUndefined();
  });

  it("replaces in place, and appends when the scope has no rule yet", () => {
    const base = rule([]);
    const rules = [base];
    const added = withRuleForScope(rules, "prj_a", rule(["prj_a"]));

    expect(added).toHaveLength(2);
    expect(added[0]).toBe(base);

    const replaced = withRuleForScope(added, "prj_a", rule(["prj_a"]));
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toBe(base);
  });

  it("removes only the named scope", () => {
    const rules = [rule([]), rule(["prj_a"]), rule(["prj_b"])];

    expect(withoutScope(rules, "prj_a").map((r) => r.projects)).toEqual([
      [],
      ["prj_b"],
    ]);
  });

  // A multi-project rule gets its own scope, so it stays visible and editable.
  it("collects every override scope across both rule families", () => {
    const flagRules = [rule([]), rule(["prj_a"])];
    const savedGroupRules = [{ required: true, projects: ["prj_b", "prj_a"] }];

    expect(overrideScopes([flagRules, savedGroupRules]).sort()).toEqual([
      "prj_a",
      "prj_a,prj_b",
    ]);
  });
});

// Regression: your dev org stores savedGroups as [{required:true}] with no
// `projects` field, so an override tab found no rule and read as "off".
describe("what an override scope inherits", () => {
  it("resolves the base rule with the scope's own rule taken out", () => {
    const rules = [
      {
        requireReviewOn: true,
        projects: [],
        environments: ["production"],
        requiredApproverTeams: ["t_sec"],
      } as RequireReview,
      {
        requireReviewOn: true,
        projects: ["prj_a"],
        requiredApproverTeams: ["t_pay"],
      } as RequireReview,
    ];

    const inherited = inheritedFlagRule(rules, "prj_a");
    // The base layer, not the override that sits on top of it.
    expect(inherited?.requiredApproverTeams).toEqual(["t_sec"]);
    expect(inherited?.environments).toEqual(["production"]);
  });

  it("has nothing to inherit at the all-projects scope", () => {
    expect(inheritedFlagRule([], ALL_PROJECTS_SCOPE)).toBeUndefined();
    expect(inheritedSavedGroupRule([], ALL_PROJECTS_SCOPE)).toBeUndefined();
  });

  it("inherits a legacy saved-group row that predates the projects field", () => {
    const legacy = [
      { required: true, autopublishOnApproval: true },
    ] as ApprovalFlowConfiguration[];

    const inherited = inheritedSavedGroupRule(legacy, "prj_a");
    expect(inherited?.required).toBe(true);
    expect(inherited?.autopublishOnApproval).toBe(true);
  });

  // The switch does not inherit, so a fresh override must carry it explicitly
  // or the tab would read as "approval off" for a scope that requires it.
  it("seeds a fresh override's switch from what the scope resolves to", () => {
    const inherited = { requireReviewOn: true, projects: [] } as RequireReview;

    expect(ownFlagRule([], "prj_a", inherited).requireReviewOn).toBe(true);
    expect(ownFlagRule([], "prj_a", undefined).requireReviewOn).toBe(false);
    expect(
      ownSavedGroupRule([], "prj_a", { required: true, projects: [] }).required,
    ).toBe(true);
  });

  it("returns the stored rule untouched when the scope has one", () => {
    const own = {
      requireReviewOn: false,
      projects: ["prj_a"],
      requiredApproverTeams: ["t_pay"],
    } as RequireReview;

    expect(ownFlagRule([own], "prj_a", undefined)).toBe(own);
  });
});
