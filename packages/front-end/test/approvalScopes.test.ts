import { describe, expect, it } from "vitest";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import { getSdkConnectionGoverningRules } from "shared/enterprise";
import {
  ALL_PROJECTS_SCOPE,
  inheritedFlagRule,
  inheritedSavedGroupRule,
  inheritedSdkConnectionRule,
  clonedFlagRule,
  clonedSavedGroupRule,
  clonedSdkConnectionRule,
  differsFromBase,
  flagRulesFromSettings,
  overrideScopes,
  ruleForScope,
  scopeKey,
  scopeProjects,
  sdkConnectionScopeDiffersFromBase,
  seededSdkConnectionRules,
  withRuleForScope,
  withScopeRetargeted,
  withSdkConnectionRuleEdited,
  withSdkConnectionScopeReset,
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
    expect(inheritedSdkConnectionRule([], ALL_PROJECTS_SCOPE)).toBeUndefined();
  });

  it("inherits a legacy saved-group row that predates the projects field", () => {
    const legacy = [
      { required: true, autopublishOnApproval: true },
    ] as ApprovalFlowConfiguration[];

    const inherited = inheritedSavedGroupRule(legacy, "prj_a");
    expect(inherited?.required).toBe(true);
    expect(inherited?.autopublishOnApproval).toBe(true);
  });

  // An override is a copy: a fresh scope starts equal to the base, otherwise a
  // new tab reads as "approval off" for a scope that in fact requires it.
  it("clones the base rule for a scope with no rule of its own", () => {
    const base = {
      requireReviewOn: true,
      projects: [],
      environments: ["production"],
      requiredApproverTeams: ["t_sec"],
    } as RequireReview;

    const clone = clonedFlagRule([base], "prj_a");
    expect(clone.requireReviewOn).toBe(true);
    expect(clone.requiredApproverTeams).toEqual(["t_sec"]);
    expect(clone.environments).toEqual(["production"]);
    // Re-pointed at this scope, so saving it stores an override.
    expect(clone.projects).toEqual(["prj_a"]);
  });

  it("clones a legacy saved-group row that predates the projects field", () => {
    const legacy = [
      { required: true, autopublishOnApproval: true },
    ] as ApprovalFlowConfiguration[];

    const clone = clonedSavedGroupRule(legacy, "prj_a");
    expect(clone.required).toBe(true);
    expect(clone.autopublishOnApproval).toBe(true);
    expect(clone.projects).toEqual(["prj_a"]);
  });

  it("returns the stored rule untouched when the scope has one", () => {
    const own = {
      requireReviewOn: false,
      projects: ["prj_a"],
      requiredApproverTeams: ["t_pay"],
    } as RequireReview;

    expect(clonedFlagRule([own], "prj_a")).toBe(own);
  });
});

describe("SDK connection rules", () => {
  const base: ApprovalFlowConfiguration = {
    required: true,
    projects: [],
    environments: ["production"],
    requiredApproverTeams: ["t_sec"],
  };

  it("inherits the base rule, environments included", () => {
    const inherited = inheritedSdkConnectionRule([base], "prj_a");
    expect(inherited?.required).toBe(true);
    expect(inherited?.environments).toEqual(["production"]);
  });

  it("clones the base into a fresh scope, re-pointed at that scope", () => {
    const clone = clonedSdkConnectionRule([base], "prj_a");
    expect(clone.environments).toEqual(["production"]);
    expect(clone.requiredApproverTeams).toEqual(["t_sec"]);
    expect(clone.projects).toEqual(["prj_a"]);
    expect(
      differsFromBase(clone, inheritedSdkConnectionRule([base], "prj_a")),
    ).toBe(false);
  });

  it("starts switched off when there is no base", () => {
    expect(clonedSdkConnectionRule([], "prj_a")).toEqual({
      required: false,
      projects: ["prj_a"],
    });
  });
});

describe("seededSdkConnectionRules", () => {
  const production: ApprovalFlowConfiguration = {
    required: true,
    projects: [],
    environments: ["production"],
  };
  const staging: ApprovalFlowConfiguration = {
    required: true,
    projects: [],
    environments: ["staging"],
    requiredApproverTeams: ["t_qa"],
  };
  const needsReview = (
    rules: ApprovalFlowConfiguration[],
    environment: string,
  ) =>
    getSdkConnectionGoverningRules(
      { savedGroups: [], sdkConnections: rules },
      { projects: ["prj_a"], environment },
    ).length > 0;

  // Regression: one combined copy kept only production's environments, so the
  // override switched staging review off for the Project.
  it("keeps every environment gated when the base has a rule per environment", () => {
    const seeded = seededSdkConnectionRules([production, staging], "prj_a");

    expect(seeded.slice(2)).toEqual([
      { ...production, projects: ["prj_a"] },
      { ...staging, projects: ["prj_a"] },
    ]);
    expect(needsReview(seeded, "production")).toBe(true);
    expect(needsReview(seeded, "staging")).toBe(true);
    expect(needsReview(seeded, "dev")).toBe(false);
  });

  it("seeds a single base rule exactly as the clone does", () => {
    const seeded = seededSdkConnectionRules([production], "prj_a");

    expect(seeded).toEqual([
      production,
      clonedSdkConnectionRule([production], "prj_a"),
    ]);
  });

  it("does not copy switched-off base rules alongside active ones", () => {
    const off = { ...staging, required: false };
    const seeded = seededSdkConnectionRules(
      [production, off, { ...staging, environments: ["dev"] }],
      "prj_a",
    );

    expect(seeded.slice(3).map((r) => r.environments)).toEqual([
      ["production"],
      ["dev"],
    ]);
  });

  it("seeds a switched-off rule when there is no base", () => {
    expect(seededSdkConnectionRules([], "prj_a")).toEqual([
      { required: false, projects: ["prj_a"] },
    ]);
  });

  it("leaves a scope that already has a rule untouched", () => {
    const rules = [
      production,
      staging,
      { required: false, projects: ["prj_a"] },
    ];
    expect(seededSdkConnectionRules(rules, "prj_a")).toBe(rules);
  });
});

describe("editing a scope with several SDK Connection rules", () => {
  const production: ApprovalFlowConfiguration = {
    required: true,
    projects: [],
    environments: ["production"],
  };
  const staging: ApprovalFlowConfiguration = {
    required: true,
    projects: [],
    environments: ["staging"],
    requiredApproverTeams: ["t_qa"],
  };
  const needsReview = (
    rules: ApprovalFlowConfiguration[],
    project: string,
    environment: string,
  ) =>
    getSdkConnectionGoverningRules(
      { savedGroups: [], sdkConnections: rules },
      { projects: [project], environment },
    ).length > 0;
  const seeded = seededSdkConnectionRules([production, staging], "prj_a");
  const edit = (
    rules: ApprovalFlowConfiguration[],
    scope: string,
    patch: Partial<ApprovalFlowConfiguration>,
  ) =>
    withSdkConnectionRuleEdited(rules, scope, {
      ...clonedSdkConnectionRule(rules, scope),
      ...patch,
    });

  // Regression: only the first seeded rule was switched off, so staging still
  // needed review while the form showed approval off.
  it("switching approval off covers every environment in the Project", () => {
    const off = edit(seeded, "prj_a", { required: false });

    expect(clonedSdkConnectionRule(off, "prj_a").required).toBe(false);
    expect(needsReview(off, "prj_a", "production")).toBe(false);
    expect(needsReview(off, "prj_a", "staging")).toBe(false);
    expect(needsReview(off, "prj_b", "production")).toBe(true);
    expect(needsReview(off, "prj_b", "staging")).toBe(true);

    const on = edit(off, "prj_a", { required: true });
    expect(needsReview(on, "prj_a", "production")).toBe(true);
    expect(needsReview(on, "prj_a", "staging")).toBe(true);
  });

  it("does the same on the All Projects scope", () => {
    const off = edit([production, staging], ALL_PROJECTS_SCOPE, {
      required: false,
    });

    expect(needsReview(off, "prj_b", "production")).toBe(false);
    expect(needsReview(off, "prj_b", "staging")).toBe(false);
  });

  it("shows the switch on while any rule in the scope is on", () => {
    const rules = [
      production,
      staging,
      { ...production, projects: ["prj_a"], required: false },
      { ...staging, projects: ["prj_a"] },
    ];

    expect(clonedSdkConnectionRule(rules, "prj_a")).toBe(rules[3]);
  });

  it("applies a field edit to every rule and keeps each one's environments", () => {
    const next = edit(seeded, "prj_a", { blockSelfApproval: true });

    expect(next.slice(0, 2)).toEqual([production, staging]);
    expect(next.slice(2)).toEqual([
      { ...production, projects: ["prj_a"], blockSelfApproval: true },
      { ...staging, projects: ["prj_a"], blockSelfApproval: true },
    ]);
  });

  // Regression: replacing the scope with the one shown rule dropped the
  // hidden staging rule, and with it review there.
  it("changes only the shown rule's environments and keeps the others", () => {
    const next = edit(seeded, "prj_a", { environments: ["production", "dev"] });

    expect(next).toEqual([
      production,
      staging,
      {
        ...production,
        projects: ["prj_a"],
        environments: ["production", "dev"],
      },
      { ...staging, projects: ["prj_a"] },
    ]);
    for (const environment of ["production", "staging", "dev"]) {
      expect(
        getSdkConnectionGoverningRules(
          { savedGroups: [], sdkConnections: next },
          { projects: ["prj_a"], environment },
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("edits a single-rule scope in place, as before", () => {
    const rules = [production, { ...production, projects: ["prj_a"] }];
    const next = { ...rules[1], required: false, environments: ["dev"] };

    expect(withSdkConnectionRuleEdited(rules, "prj_a", next)).toEqual(
      withRuleForScope(rules, "prj_a", next),
    );
  });

  it("resets the scope to every base rule and offers no reset when untouched", () => {
    expect(sdkConnectionScopeDiffersFromBase(seeded, "prj_a")).toBe(false);

    const off = edit(seeded, "prj_a", { required: false });
    expect(sdkConnectionScopeDiffersFromBase(off, "prj_a")).toBe(true);

    const reset = withSdkConnectionScopeReset(off, "prj_a");
    expect(reset).toEqual(seeded);
    expect(needsReview(reset, "prj_a", "staging")).toBe(true);
  });

  it("resets a single-rule scope in place, as before", () => {
    const rules = [
      production,
      { required: false, projects: ["prj_a"] },
      { required: true, projects: ["prj_b"] },
    ];

    expect(sdkConnectionScopeDiffersFromBase(rules, "prj_a")).toBe(true);
    expect(withSdkConnectionScopeReset(rules, "prj_a")).toEqual(
      withRuleForScope(
        rules,
        "prj_a",
        clonedSdkConnectionRule(withoutScope(rules, "prj_a"), "prj_a"),
      ),
    );
  });
});

describe("withScopeRetargeted", () => {
  it("re-points every rule in the scope and nothing else", () => {
    const rules: ApprovalFlowConfiguration[] = [
      { required: true, projects: [] },
      { required: true, projects: ["prj_a"], environments: ["production"] },
      { required: true, projects: ["prj_a"], environments: ["staging"] },
      { required: true, projects: ["prj_b"] },
    ];

    expect(
      withScopeRetargeted(rules, "prj_a", ["prj_a", "prj_c"]).map(
        (r) => r.projects,
      ),
    ).toEqual([[], ["prj_a", "prj_c"], ["prj_a", "prj_c"], ["prj_b"]]);
  });
});

// Saved Groups keep the single-rule clone they had before.
describe("saved-group override seeding", () => {
  it("clones one combined rule, as before", () => {
    const rules: ApprovalFlowConfiguration[] = [
      { required: true, projects: [], requiredApproverTeams: ["t_sec"] },
    ];
    expect(clonedSavedGroupRule(rules, "prj_a")).toEqual({
      required: true,
      projects: ["prj_a"],
      requiredApproverTeams: ["t_sec"],
    });
  });
});

describe("differsFromBase", () => {
  const base = {
    requireReviewOn: true,
    projects: [],
    environments: ["production"],
  } as RequireReview;

  // A fresh clone matches the base, so a section offers no reset until edited.
  it("is false for an untouched clone", () => {
    expect(differsFromBase({ ...base, projects: ["prj_a"] }, base)).toBe(false);
  });

  it("ignores the selector, which is what names the scope", () => {
    expect(
      differsFromBase({ ...base, projects: ["prj_a", "prj_b"] }, base),
    ).toBe(false);
  });

  it("is true once any governed field diverges", () => {
    expect(
      differsFromBase(
        { ...base, projects: ["prj_a"], requireReviewOn: false },
        base,
      ),
    ).toBe(true);
    expect(
      differsFromBase(
        { ...base, projects: ["prj_a"], requiredApproverTeams: ["t_sec"] },
        base,
      ),
    ).toBe(true);
  });

  // Absence is the only unset form now, but a stray null from an older client
  // must still not read as a difference.
  it("treats a null field as absent", () => {
    expect(
      differsFromBase(
        {
          ...base,
          projects: ["prj_a"],
          requiredApproverTeams: null,
        } as unknown as RequireReview,
        base,
      ),
    ).toBe(false);
  });

  it("is false when there is no base to compare against", () => {
    expect(differsFromBase(base, undefined)).toBe(false);
  });
});

// A legacy boolean setting read as `[]` showed "approval not required", and
// saving that form wrote requireReviewOn:false — turning review off org-wide.
describe("flagRulesFromSettings", () => {
  it("surfaces a legacy true as an all-projects rule that requires review", () => {
    const rules = flagRulesFromSettings(true);

    expect(rules).toHaveLength(1);
    expect(rules[0].requireReviewOn).toBe(true);
    expect(rules[0].projects).toEqual([]);
  });

  it("treats a legacy false, and an absent setting, as no rules", () => {
    expect(flagRulesFromSettings(false)).toEqual([]);
    expect(flagRulesFromSettings(undefined)).toEqual([]);
  });

  it("passes a real rule array through untouched", () => {
    const rules = [
      { requireReviewOn: true, projects: ["prj_a"] } as RequireReview,
    ];
    expect(flagRulesFromSettings(rules)).toBe(rules);
  });
});
