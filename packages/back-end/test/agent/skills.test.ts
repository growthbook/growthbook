import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { _loadSkillsFromDirectory } from "back-end/src/agent/skills";

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
});
