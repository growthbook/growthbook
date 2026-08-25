import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  _loadSkillsFromDirectory,
  _resolveSkill,
  getSkillNamesForGroup,
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

    // The Product Analytics chat scopes itself to the `dashboards` domain, so
    // both workflows must load — a missing one silently disappears from that
    // chat's `/` menu and from what its agent can reach.
    expect(
      summaries.filter((s) => s.group === "dashboards").map(({ name }) => name),
    ).toEqual([
      "dashboards",
      "dashboards/references/dashboard-create",
      "dashboards/references/dashboard-edit",
    ]);
  });
});

describe("getSkillNamesForGroup", () => {
  it("returns nothing for a name that is not a domain", () => {
    expect(getSkillNamesForGroup("nope")).toEqual([]);
    // A workflow's qualified name is not a group name.
    expect(
      getSkillNamesForGroup("dashboards/references/dashboard-create"),
    ).toEqual([]);
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
