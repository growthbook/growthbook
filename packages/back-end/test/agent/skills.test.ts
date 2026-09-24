import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  _loadSkillsFromDirectory,
  _mergeCustomSkills,
  _parseDisabledBuiltIns,
  _resolveSkill,
} from "back-end/src/agent/skills";

function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSkillsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-"));

  writeFixtureFile(
    join(root, "example-domain", "SKILL.md"),
    `---
name: example-domain
description: Example domain workflows
---

Read \`references/do-thing.md\`.
`,
  );
  writeFixtureFile(
    join(root, "example-domain", "references", "do-thing.md"),
    `---
name: do-thing
description: Do the thing
---

# Do the thing
`,
  );
  writeFixtureFile(
    join(root, "standalone", "SKILL.md"),
    `---
name: standalone
description: A standalone skill with no workflows
---

# Standalone
`,
  );

  return root;
}

function createWorkflowFixture(domains: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-"));
  for (const [domain, workflows] of Object.entries(domains)) {
    writeFixtureFile(
      join(root, domain, "SKILL.md"),
      `---\nname: ${domain}\ndescription: ${domain} workflows\n---\n\n# ${domain}\n`,
    );
    for (const workflow of workflows) {
      writeFixtureFile(
        join(root, domain, "references", `${workflow}.md`),
        `---\nname: ${workflow}\ndescription: ${workflow}\n---\n\n# ${workflow}\n`,
      );
    }
  }
  return root;
}

describe("agent skills loader", () => {
  it("returns an empty registry when no skills directory is present", () => {
    const { summaries, skills } = _loadSkillsFromDirectory(null);

    expect(summaries).toEqual([]);
    expect(skills.size).toBe(0);
  });

  it("loads domain frontmatter and qualified workflows from a directory", () => {
    const root = createSkillsFixture();
    try {
      const { summaries, skills } = _loadSkillsFromDirectory(root);
      const domains = summaries.filter((s) => s.kind === "domain");

      expect(domains.map(({ name }) => name).sort()).toEqual([
        "example-domain",
        "standalone",
      ]);
      expect(domains).toContainEqual(
        expect.objectContaining({
          name: "example-domain",
          description: "Example domain workflows",
        }),
      );
      expect(skills.get("example-domain/references/do-thing")?.body).toContain(
        "Do the thing",
      );
      expect(skills.get("standalone")?.body).toContain("# Standalone");
      expect(domains.map(({ name }) => name)).not.toContain(
        "example-domain/references/do-thing",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads in-repo local skills without assembling", () => {
    const localSkillsDir = join(
      __dirname,
      "..",
      "..",
      "src",
      "agent",
      "skills-local",
    );
    const { summaries, skills } = _loadSkillsFromDirectory(localSkillsDir);

    expect(summaries).toContainEqual(
      expect.objectContaining({
        name: "growthbook-docs",
        description: expect.any(String),
      }),
    );
    expect(skills.get("growthbook-docs")?.body).toContain(
      "GrowthBook documentation",
    );
  });

  it("reads multi-line YAML descriptions and tolerates invalid YAML", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-skills-"));
    writeFixtureFile(
      join(root, "folded", "SKILL.md"),
      `---\nname: folded\ndescription: >\n  Spans\n  two lines\n---\n\n# Folded\n`,
    );
    writeFixtureFile(
      join(root, "loose", "SKILL.md"),
      `---\nname: loose\ndescription: Use when: the YAML is invalid\n---\n\n# Loose\n`,
    );
    try {
      const { skills } = _loadSkillsFromDirectory(root);

      expect(skills.get("folded")?.description).toBe("Spans two lines");
      expect(skills.get("loose")?.description).toBe(
        "Use when: the YAML is invalid",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("custom skills", () => {
  const builtInRoot = createWorkflowFixture({
    "feature-flags": ["flag-create"],
    experiments: ["experiment-stop"],
  });
  const customRoot = createWorkflowFixture({
    "feature-flags": ["flag-custom"],
    "release-checklist": [],
  });
  const builtIn = _loadSkillsFromDirectory(builtInRoot);
  const custom = _loadSkillsFromDirectory(customRoot);
  const names = ({ summaries }: { summaries: { name: string }[] }) =>
    summaries.map((s) => s.name);

  afterAll(() => {
    rmSync(builtInRoot, { recursive: true, force: true });
    rmSync(customRoot, { recursive: true, force: true });
  });

  it("adds custom domains and replaces a same-named built-in wholesale", () => {
    const merged = _mergeCustomSkills(builtIn, custom, new Set());

    expect(names(merged)).toEqual([
      "experiments",
      "experiments/references/experiment-stop",
      "feature-flags",
      "feature-flags/references/flag-custom",
      "release-checklist",
    ]);
    expect(merged.skills.has("feature-flags/references/flag-create")).toBe(
      false,
    );
  });

  it("drops the named built-ins, or all of them", () => {
    const empty = { summaries: [], skills: new Map() };

    expect(
      names(_mergeCustomSkills(builtIn, empty, new Set(["experiments"]))),
    ).toEqual(["feature-flags", "feature-flags/references/flag-create"]);
    expect(names(_mergeCustomSkills(builtIn, custom, "all"))).toEqual(
      names(custom),
    );
  });

  it("parses AGENT_SKILLS_DISABLE_BUILTINS", () => {
    expect(_parseDisabledBuiltIns("TRUE")).toBe("all");
    expect(_parseDisabledBuiltIns(" experiments, ,analytics ")).toEqual(
      new Set(["experiments", "analytics"]),
    );
  });
});

describe("skill name resolution", () => {
  const root = createWorkflowFixture({
    "feature-flags": ["flag-create", "flag-toggle"],
    experiments: ["experiment-stop"],
    standalone: [],
  });
  const { skills } = _loadSkillsFromDirectory(root);
  const resolvedName = (name: string) => _resolveSkill(skills, name)?.name;

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("resolves qualified workflow names and domain names exactly", () => {
    expect(resolvedName("feature-flags/references/flag-create")).toBe(
      "feature-flags/references/flag-create",
    );
    expect(resolvedName("feature-flags")).toBe("feature-flags");
  });

  it("resolves the shapes a domain router and its siblings use", () => {
    // The router's table lists `references/<workflow>.md`.
    expect(resolvedName("references/flag-create.md")).toBe(
      "feature-flags/references/flag-create",
    );
    // Cross-domain handoffs name the workflow alone.
    expect(resolvedName("experiment-stop")).toBe(
      "experiments/references/experiment-stop",
    );
    // A qualified name that kept its extension, and stray whitespace.
    expect(resolvedName("feature-flags/references/flag-toggle.md")).toBe(
      "feature-flags/references/flag-toggle",
    );
    expect(resolvedName(" standalone.md ")).toBe("standalone");
  });

  it("returns undefined for unknown names", () => {
    expect(resolvedName("flag-nonexistent")).toBeUndefined();
    expect(resolvedName("references/")).toBeUndefined();
  });

  it("returns undefined when a bare workflow name is ambiguous", () => {
    const ambiguousRoot = createWorkflowFixture({
      "domain-a": ["shared-workflow"],
      "domain-b": ["shared-workflow"],
    });
    try {
      const { skills: ambiguous } = _loadSkillsFromDirectory(ambiguousRoot);

      expect(_resolveSkill(ambiguous, "shared-workflow")).toBeUndefined();
      expect(
        _resolveSkill(ambiguous, "domain-a/references/shared-workflow")?.name,
      ).toBe("domain-a/references/shared-workflow");
    } finally {
      rmSync(ambiguousRoot, { recursive: true, force: true });
    }
  });
});
