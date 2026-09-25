import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OrganizationInterface } from "shared/types/organization";
import {
  _dirSignature,
  _enabledFor,
  _loadSkillsFromDirectory,
  _mergeCustomSkills,
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

  it("skips a skill whose name isn't a slug", () => {
    const root = createWorkflowFixture({ ok: [] });
    writeFixtureFile(
      join(root, "bad", "SKILL.md"),
      `---\nname: Release/Checklist\ndescription: Bad name\n---\n`,
    );
    try {
      expect([..._loadSkillsFromDirectory(root).skills.keys()]).toEqual(["ok"]);
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
    const merged = _mergeCustomSkills(builtIn, custom);

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

  it("tags custom skills so settings can badge them", () => {
    const merged = _mergeCustomSkills(builtIn, custom);

    expect(merged.skills.get("release-checklist")?.custom).toBe(true);
    expect(merged.skills.get("experiments")?.custom).toBeUndefined();
  });

  it("filters out a domain and its workflows that the org turned off", () => {
    const enabled = _enabledFor({
      settings: { disabledAgentSkills: ["experiments"] },
    } as OrganizationInterface);

    expect(builtIn.summaries.filter(enabled).map((s) => s.name)).toEqual([
      "feature-flags",
      "feature-flags/references/flag-create",
    ]);
  });

  it("changes the directory signature on an edit or a new file", () => {
    const root = createWorkflowFixture({ "release-checklist": [] });
    try {
      const skillFile = join(root, "release-checklist", "SKILL.md");
      const before = _dirSignature(root);
      expect(_dirSignature(root)).toBe(before);

      utimesSync(skillFile, new Date(), new Date(Date.now() + 5000));
      const edited = _dirSignature(root);
      expect(edited).not.toBe(before);

      writeFixtureFile(
        join(root, "release-checklist", "references", "a.md"),
        "",
      );
      expect(_dirSignature(root)).not.toBe(edited);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("picks up new custom skills once the recheck window passes", async () => {
    const root = createWorkflowFixture({ "release-checklist": [] });
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const org = { settings: {} } as OrganizationInterface;
    process.env.AGENT_SKILLS_DIR = root;
    try {
      await jest.isolateModulesAsync(async () => {
        const { listDomainSkills } = await import("back-end/src/agent/skills");
        const names = () => listDomainSkills(org).map((s) => s.name);

        expect(names()).toContain("release-checklist");
        writeFixtureFile(
          join(root, "rollout", "SKILL.md"),
          "---\nname: rollout\ndescription: Roll out\n---\n",
        );
        expect(names()).not.toContain("rollout");

        now.mockReturnValue(1_031_000);
        expect(names()).toContain("rollout");
      });
    } finally {
      delete process.env.AGENT_SKILLS_DIR;
      now.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("skill files", () => {
  const root = createWorkflowFixture({ "release-checklist": ["prepare"] });
  const dir = join(root, "release-checklist");
  writeFixtureFile(join(dir, "examples", "payload.json"), '{"id": 1}');
  writeFixtureFile(join(dir, "scripts", "sync.sh"), "curl $HOST\n");
  writeFixtureFile(join(dir, "logo.png"), "\x89PNG\x00\x00");
  writeFixtureFile(join(dir, ".hidden", "notes.md"), "secret");
  symlinkSync(join(root, "missing.md"), join(dir, "dangling.md"));
  const { summaries, skills } = _loadSkillsFromDirectory(root);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("indexes other text files by path, but keeps them out of the menu", () => {
    expect(skills.get("release-checklist/examples/payload.json")?.body).toBe(
      '{"id": 1}',
    );
    expect(skills.get("release-checklist/scripts/sync.sh")?.kind).toBe("file");
    expect(summaries.map((s) => s.name)).toEqual([
      "release-checklist",
      "release-checklist/references/prepare",
    ]);
  });

  it("skips binary, hidden and unreadable files, and the files already loaded as skills", () => {
    const files = [...skills.values()].filter((s) => s.kind === "file");
    expect(files.map((s) => s.name)).toEqual([
      "release-checklist/examples/payload.json",
      "release-checklist/scripts/sync.sh",
    ]);
  });

  it("resolves a file by the relative path its skill uses", () => {
    const resolvedName = (name: string) => _resolveSkill(skills, name)?.name;
    expect(resolvedName("examples/payload.json")).toBe(
      "release-checklist/examples/payload.json",
    );
    expect(resolvedName("./scripts/sync.sh")).toBe(
      "release-checklist/scripts/sync.sh",
    );
  });

  it("still resolves a bare workflow name when a file shares it", () => {
    const tools = createWorkflowFixture({ tools: [] });
    writeFixtureFile(join(tools, "tools", "scripts", "prepare"), "echo\n");
    try {
      const merged = new Map([
        ...skills,
        ..._loadSkillsFromDirectory(tools).skills,
      ]);
      expect(_resolveSkill(merged, "prepare")?.name).toBe(
        "release-checklist/references/prepare",
      );
      expect(_resolveSkill(merged, "scripts/prepare")?.name).toBe(
        "tools/scripts/prepare",
      );
    } finally {
      rmSync(tools, { recursive: true, force: true });
    }
  });

  it("keeps the signature sensitive to edits when a symlink dangles", () => {
    const before = _dirSignature(root);
    expect(before).toContain("dangling.md:unreadable");
    utimesSync(
      join(dir, "SKILL.md"),
      new Date(),
      new Date(Date.now() + 10_000),
    );
    expect(_dirSignature(root)).not.toBe(before);
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
