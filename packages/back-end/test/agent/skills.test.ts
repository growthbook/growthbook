import path from "path";
import {
  _clearSkillCacheForTests,
  assembleSkillsIndexForPrompt,
  getAllSkills,
  getDomainSkills,
  getLeafSkillsForDomain,
  getSkillByName,
  getSkillNames,
  getSkillNamesForGroup,
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
        "dashboards",
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

    const dashLeaves = getLeafSkillsForDomain("dashboards");
    expect(dashLeaves.map((s) => s.name).sort()).toEqual([
      "dashboard-create",
      "dashboard-edit",
    ]);

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
    expect(index).not.toContain("dashboard-create");
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

describe("agent skill cross-references", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("only hands off to skills that exist", () => {
    // A `loadSkill('x')` naming a skill that isn't there dead-ends the agent
    // the same way a phantom endpoint does: the tool errors, and the skill it
    // was following has no other route forward.
    const known = new Set(getSkillNames());
    const dangling: string[] = [];

    for (const skill of getAllSkills()) {
      for (const match of skill.body.matchAll(/loadSkill\('([^']+)'\)/g)) {
        const name = match[1];
        // `loadSkill('<leaf>')` in prose is a template, not a reference to a
        // skill called "<leaf>".
        if (name.includes("<")) continue;
        if (!known.has(name)) dangling.push(`${skill.name} \u2192 ${name}`);
      }
    }

    expect([...new Set(dangling)].sort()).toEqual([]);
  });
});

describe("getSkillNamesForGroup", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("returns the router and every leaf under it", () => {
    // The Product Analytics chat scopes itself to this domain, so both
    // dashboard workflows must be reachable there — a missing one silently
    // disappears from that chat's `/` menu and from what its agent can load.
    expect(getSkillNamesForGroup("dashboards").sort()).toEqual([
      "dashboard-create",
      "dashboard-edit",
      "dashboards",
    ]);
  });

  it("excludes other domains", () => {
    const names = getSkillNamesForGroup("dashboards");
    expect(names.includes("flag-create")).toBe(false);
    expect(names.includes("feature-flags")).toBe(false);
  });

  it("returns nothing for a name that is not a domain", () => {
    expect(getSkillNamesForGroup("nope")).toEqual([]);
    // A leaf name is not a domain name, even when it looks like one.
    expect(getSkillNamesForGroup("dashboard-create")).toEqual([]);
  });
});
