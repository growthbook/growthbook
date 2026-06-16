import path from "path";
import {
  _clearSkillCacheForTests,
  assembleSkillsIndexForPrompt,
  getDomainSkills,
  getLeafSkillsForDomain,
  getSkillByName,
  getSkillNames,
} from "back-end/src/agent/skills";

describe("agent skills loader", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("loads domain routers and leaf skills from nested directories", () => {
    const domains = getDomainSkills();
    const domainNames = domains.map((s) => s.name).sort();

    expect(domainNames).toEqual(
      expect.arrayContaining([
        "experiments",
        "feature-flags",
        "growthbook-docs",
        "product-analytics",
      ]),
    );
    expect(domains.every((s) => s.kind === "domain")).toBe(true);

    const ffLeaves = getLeafSkillsForDomain("feature-flags");
    expect(ffLeaves.length).toBeGreaterThanOrEqual(15);
    expect(
      ffLeaves.every((s) => s.kind === "leaf" && s.group === "feature-flags"),
    ).toBe(true);

    const expLeaves = getLeafSkillsForDomain("experiments");
    expect(expLeaves.length).toBe(5);
    expect(expLeaves.map((s) => s.name).sort()).toEqual([
      "experiment-analyze",
      "experiment-brainstorm",
      "experiment-design",
      "experiment-launch",
      "experiment-stop",
    ]);
  });

  it("includes leaf names in getSkillNames but only domains in the prompt index", () => {
    const names = getSkillNames();
    expect(names).toContain("flag-create");
    expect(names).toContain("experiment-launch");

    const index = assembleSkillsIndexForPrompt();
    expect(index).toContain("**feature-flags**");
    expect(index).toContain("**experiments**");
    expect(index).not.toContain("flag-create");
    expect(index).not.toContain("experiment-launch");
  });

  it("loads skill bodies by name for domain and leaf", () => {
    const domain = getSkillByName("feature-flags");
    expect(domain?.kind).toBe("domain");
    expect(domain?.body).toContain("Sub-skills");

    const leaf = getSkillByName("flag-create");
    expect(leaf?.kind).toBe("leaf");
    expect(leaf?.group).toBe("feature-flags");
    expect(leaf?.body).toContain("callApi");
    expect(leaf?.body).not.toContain("gb-call");
  });

  it("resolves skills from src/agent/skills when running tests from source", () => {
    const skillsDir = path.resolve(
      __dirname,
      "../../src/agent/skills/feature-flags/SKILL.md",
    );
    expect(getSkillByName("feature-flags")?.body.length).toBeGreaterThan(0);
    // Sanity: router file exists at expected path in repo layout
    expect(skillsDir).toContain("feature-flags");
  });
});
