import path from "path";
import {
  _clearSkillCacheForTests,
  assembleSkillsIndexForPrompt,
  getAllSkills,
  getSkillByName,
  getSkillNames,
  getSkillNamesForGroup,
  getSkillsForGroup,
} from "back-end/src/agent/skills";

describe("agent skills loader", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("loads every markdown file as a skill in its own right", () => {
    const names = getSkillNames();

    expect(names).toEqual(
      expect.arrayContaining([
        // Top-level files.
        "growthbook-docs",
        "product-analytics",
        // A directory's SKILL.md takes the directory's name...
        "experiments",
        "feature-flags",
        // ...and the files beside it are skills too, not sub-entries of it.
        "experiment-launch",
        "flag-create",
      ]),
    );
  });

  it("groups a skill by the directory it lives in", () => {
    expect(getSkillByName("flag-create")?.group).toBe("feature-flags");
    expect(getSkillByName("feature-flags")?.group).toBe("feature-flags");
    // A top-level file belongs to no directory.
    expect(getSkillByName("product-analytics")?.group).toBeUndefined();
  });

  it("puts the shared-conventions skill at the head of its group", () => {
    // The menu and the prompt index show this order, and the conventions read
    // better before the workflows that lean on them.
    const experiments = getSkillsForGroup("experiments").map((s) => s.name);
    expect(experiments[0]).toBe("experiments");
    expect(experiments).toEqual(
      expect.arrayContaining([
        "experiment-analyze",
        "experiment-brainstorm",
        "experiment-design",
        "experiment-launch",
        "experiment-stop",
      ]),
    );
    expect(experiments.length).toBe(6);
  });

  it("advertises every loadable skill in the prompt index", () => {
    // The index is now the only place the agent learns a skill's name — there
    // is no router table to read on the way in. A skill missing from it is
    // unreachable however well it is written.
    const index = assembleSkillsIndexForPrompt();

    for (const skill of getAllSkills()) {
      expect(index).toContain(`**${skill.name}**`);
    }
  });

  it("loads skill bodies by name", () => {
    const conventions = getSkillByName("feature-flags");
    expect(conventions?.body).toContain("Shared conventions");

    const workflow = getSkillByName("flag-create");
    expect(workflow?.body).toContain("callApi");
    expect(workflow?.body).not.toContain("gb-call");
  });

  it("resolves skills from src/agent/skills when running tests from source", () => {
    const skillsDir = path.resolve(
      __dirname,
      "../../src/agent/skills/feature-flags/SKILL.md",
    );
    expect(getSkillByName("feature-flags")?.body.length).toBeGreaterThan(0);
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
        if (!known.has(name)) dangling.push(`${skill.name} → ${name}`);
      }
    }

    expect([...new Set(dangling)].sort()).toEqual([]);
  });
});

describe("getSkillNamesForGroup", () => {
  beforeEach(() => {
    _clearSkillCacheForTests();
  });

  it("returns every skill filed under the directory", () => {
    // The Product Analytics chat scopes itself to this group, so both dashboard
    // workflows must be reachable there — a missing one silently disappears
    // from that chat's `/` menu and from what its agent can load.
    const names = getSkillNamesForGroup("dashboards");
    expect(names.includes("dashboards")).toBe(true);
    expect(names.includes("dashboard-create")).toBe(true);
    expect(names.includes("dashboard-edit")).toBe(true);
  });

  it("excludes other groups", () => {
    const names = getSkillNamesForGroup("dashboards");
    expect(names.includes("flag-create")).toBe(false);
    expect(names.includes("feature-flags")).toBe(false);
  });

  it("returns nothing for a name that is not a group", () => {
    expect(getSkillNamesForGroup("nope")).toEqual([]);
    // A skill name is not a directory name, even when it looks like one.
    expect(getSkillNamesForGroup("dashboard-create")).toEqual([]);
  });
});
