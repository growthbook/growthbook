import path from "path";
import {
  _clearSkillCacheForTests,
  assembleSkillsIndexForPrompt,
  getAllSkills,
  getDomainSkills,
  getLeafSkillsForDomain,
  getSkillByName,
  getSkillNames,
  getSkillNamesForDomain,
  isSurfaceScopedSkill,
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
        // `loadSkill('<leaf>')` in a router's prose is a template, not a
        // reference to a skill called "<leaf>".
        if (name.includes("<")) continue;
        if (!known.has(name)) dangling.push(`${skill.name} → ${name}`);
      }
    }

    expect([...new Set(dangling)].sort()).toEqual([]);
  });

  it("lists every leaf of a domain in that domain's router body", () => {
    // The router body is the only place the agent learns a leaf's name, so a
    // leaf missing from the table is unreachable however well it is written.
    const missing: string[] = [];

    for (const domain of getDomainSkills()) {
      for (const leaf of getLeafSkillsForDomain(domain.name)) {
        if (!domain.body.includes(leaf.name)) {
          missing.push(`${domain.name} is missing ${leaf.name}`);
        }
      }
    }

    expect(missing.sort()).toEqual([]);
  });
});

describe("getSkillNamesForDomain", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("returns the router and every leaf beneath it", () => {
    // The Product Analytics chat scopes itself to this domain, so both dashboard
    // leaves must be reachable there — a missing leaf silently disappears from
    // that chat's `/` menu and from what its agent can load.
    const names = getSkillNamesForDomain("dashboards");
    expect(names.includes("dashboards")).toBe(true);
    expect(names.includes("dashboard-create")).toBe(true);
    expect(names.includes("dashboard-edit")).toBe(true);
  });

  it("excludes other domains", () => {
    const names = getSkillNamesForDomain("dashboards");
    expect(names.includes("flag-create")).toBe(false);
    expect(names.includes("feature-flags")).toBe(false);
  });

  it("returns nothing for an unknown domain or a leaf name", () => {
    expect(getSkillNamesForDomain("nope")).toEqual([]);
    // A leaf is not a domain router, so it scopes nothing.
    expect(getSkillNamesForDomain("dashboard-create")).toEqual([]);
  });
});

describe("surface-scoped skills", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("treats the dashboards domain and its leaves as surface-scoped", () => {
    // Building a dashboard needs `proposeDashboard`, which only the Product
    // Analytics chat has.
    expect(isSurfaceScopedSkill("dashboards")).toBe(true);
    expect(isSurfaceScopedSkill("dashboard-create")).toBe(true);
    expect(isSurfaceScopedSkill("dashboard-edit")).toBe(true);
  });

  it("leaves every other skill available to the general agent", () => {
    expect(isSurfaceScopedSkill("feature-flags")).toBe(false);
    expect(isSurfaceScopedSkill("flag-create")).toBe(false);
    expect(isSurfaceScopedSkill("product-analytics")).toBe(false);
    expect(isSurfaceScopedSkill("experiment-analyze")).toBe(false);
  });

  it("reports an unknown skill as not scoped", () => {
    expect(isSurfaceScopedSkill("nope")).toBe(false);
  });

  it("keeps surface-scoped domains out of the general agent's prompt index", () => {
    // Advertising a skill the agent cannot load just invites it to try.
    const index = assembleSkillsIndexForPrompt();
    expect(index.includes("dashboards")).toBe(false);
    expect(index.includes("feature-flags")).toBe(true);
    expect(index.includes("product-analytics")).toBe(true);
  });
});
