import { listDomainSkills, readSkill } from "back-end/src/agent/skills";

// Contributors without a growthbook/skills checkout get local-only skills, so
// assertions against canonical content skip.
const hasGeneratedWorkflows =
  readSkill("feature-flags/references/flag-create") !== undefined;
const describeWorkflows = hasGeneratedWorkflows ? describe : describe.skip;

describe("agent skills loader", () => {
  it("lists domain frontmatter", () => {
    const domains = listDomainSkills();

    expect(domains).toContainEqual(
      expect.objectContaining({
        name: "growthbook-docs",
        description: expect.any(String),
      }),
    );
    expect(domains.map(({ name }) => name)).not.toContain(
      "feature-flags/references/flag-create",
    );
  });

  it("loads a standalone local skill by name", () => {
    const domain = readSkill("growthbook-docs");

    expect(domain?.body).toContain("GrowthBook documentation");
  });
});

describeWorkflows("agent skills generated from growthbook/skills", () => {
  it("loads canonical domains and qualified workflows", () => {
    expect(
      listDomainSkills()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["analytics", "experiments", "feature-flags", "growthbook-docs"]);

    const workflowNames = [
      "feature-flags/references/flag-create",
      "experiments/references/experiment-analyze",
      "experiments/references/experiment-brainstorm",
      "experiments/references/experiment-design",
      "experiments/references/experiment-launch",
      "experiments/references/experiment-stop",
      "analytics/references/analytics-explore",
      "analytics/references/metric-search",
    ];
    for (const name of workflowNames) {
      expect(readSkill(name)?.name).toBe(name);
    }
    expect(readSkill("gb-setup")).toBeUndefined();
    expect(readSkill("product-analytics")).toBeUndefined();
  });

  it("preserves canonical skill content unchanged", () => {
    const leaf = readSkill("feature-flags/references/flag-create");

    expect(leaf?.body).toContain("gb-call GET /api/v2/feature-keys");
    expect(leaf?.body).toContain("`references/flag-rules.md`");

    const router = readSkill("analytics");
    expect(router?.body).toContain("`references/analytics-explore.md`");
    expect(router?.body).toContain("gb-setup");
  });

  it("preserves runtime-specific steps for the system prompt to translate", () => {
    const cleanup = readSkill("feature-flags/references/flag-cleanup");
    expect(cleanup?.body).toContain("Use the Read tool");
    expect(cleanup?.body).toContain("Grep tool");

    const analyze = readSkill("experiments/references/experiment-analyze");
    expect(analyze?.body).toContain("for i in");
    expect(analyze?.body).toContain("sleep 5");

    const analytics = readSkill("analytics/references/analytics-explore");
    expect(analytics?.body).toContain("sleep 10");
  });
});
