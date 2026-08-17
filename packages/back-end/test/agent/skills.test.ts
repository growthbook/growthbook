import {
  _clearSkillCacheForTests,
  assembleSkillsIndexForPrompt,
  getDomainSkills,
  getLeafSkillsForDomain,
  getSkillByName,
  getSkillNames,
} from "back-end/src/agent/skills";

// Contributors without a growthbook/skills checkout get local-only skills, so
// assertions against canonical content skip.
const hasGeneratedWorkflows =
  getLeafSkillsForDomain("feature-flags").length > 0;
const describeWorkflows = hasGeneratedWorkflows ? describe : describe.skip;

describe("agent skills loader", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("loads the checked-in local skill", () => {
    const domains = getDomainSkills();

    expect(domains.map((s) => s.name)).toContain("growthbook-docs");
    expect(domains.every((s) => s.kind === "domain")).toBe(true);
  });

  it("lists only domains in the prompt index", () => {
    const index = assembleSkillsIndexForPrompt();

    expect(index).toContain("**growthbook-docs**");
    expect(index).not.toContain("flag-create");
    expect(index).not.toContain("experiment-launch");
  });

  it("loads a standalone local skill by name", () => {
    const domain = getSkillByName("growthbook-docs");

    expect(domain?.kind).toBe("domain");
    expect(domain?.group).toBeUndefined();
    expect(domain?.body).toContain("GrowthBook documentation");
  });
});

describeWorkflows("agent skills generated from growthbook/skills", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("groups every workflow under its domain", () => {
    expect(
      getDomainSkills()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["analytics", "experiments", "feature-flags", "growthbook-docs"]);

    const ffLeaves = getLeafSkillsForDomain("feature-flags");
    expect(ffLeaves.length).toBe(17);
    expect(
      ffLeaves.every(
        (s) =>
          s.kind === "leaf" &&
          s.group === "feature-flags" &&
          s.name.startsWith("feature-flags/references/"),
      ),
    ).toBe(true);

    expect(
      getLeafSkillsForDomain("experiments")
        .map((s) => s.name)
        .sort(),
    ).toEqual([
      "experiments/references/experiment-analyze",
      "experiments/references/experiment-brainstorm",
      "experiments/references/experiment-design",
      "experiments/references/experiment-launch",
      "experiments/references/experiment-stop",
    ]);
    expect(
      getLeafSkillsForDomain("analytics")
        .map((s) => s.name)
        .sort(),
    ).toEqual([
      "analytics/references/analytics-explore",
      "analytics/references/metric-search",
    ]);

    const names = getSkillNames();
    expect(names).toContain("feature-flags/references/flag-create");
    expect(names).toContain("experiments/references/experiment-launch");
    expect(names).not.toContain("gb-setup");
    expect(names).not.toContain("product-analytics");
  });

  it("rewrites the upstream runtime contract", () => {
    const leaf = getSkillByName("feature-flags/references/flag-create");

    expect(leaf?.kind).toBe("leaf");
    expect(leaf?.group).toBe("feature-flags");
    expect(leaf?.body).toContain("Translate `gb-call METHOD PATH [body]`");
    expect(leaf?.body).toContain(
      "loadSkill('feature-flags/references/flag-rules')",
    );
    expect(leaf?.body).not.toContain("allowed-tools:");
    expect(leaf?.body).not.toMatch(/`references\/[a-z0-9-]+\.md`/);

    const router = getSkillByName("analytics");
    expect(router?.body).toContain(
      "loadSkill('analytics/references/analytics-explore')",
    );
    expect(router?.body).not.toContain("gb-setup");
  });

  it("drops steps this runtime has no tools for", () => {
    const cleanup = getSkillByName("feature-flags/references/flag-cleanup");
    expect(cleanup?.body).not.toContain("Use the Read tool");
    expect(cleanup?.body).not.toContain("Grep tool");

    const analyze = getSkillByName("experiments/references/experiment-analyze");
    expect(analyze?.body).toContain("Check once, then re-fetch when ready");
    expect(analyze?.body).not.toContain("for i in");
    expect(analyze?.body).not.toContain("sleep 5");

    const analytics = getSkillByName("analytics/references/analytics-explore");
    expect(analytics?.body).toContain("never sleep or re-POST just to poll");
    expect(analytics?.body).not.toContain("sleep 10");
  });
});
