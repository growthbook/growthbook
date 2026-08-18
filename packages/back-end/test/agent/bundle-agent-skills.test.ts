import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertNoSkillNameCollision,
  bundleSkills,
  CANONICAL_SKILLS,
} from "../../scripts/bundle-agent-skills";

function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSkillsFixture(): {
  root: string;
  source: string;
  localSource: string;
  destination: string;
} {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-"));
  const source = join(root, "canonical");
  const localSource = join(root, "local");
  const destination = join(root, "generated", "agent-skills");

  for (const domain of CANONICAL_SKILLS) {
    writeFixtureFile(
      join(source, "skills", domain, "SKILL.md"),
      `---
name: ${domain}
description: ${domain} workflows
---

Read \`references/shared.md\`.
`,
    );
    writeFixtureFile(
      join(source, "skills", domain, "references", "shared.md"),
      `# Shared workflow

Workflow for ${domain}.
`,
    );
  }

  writeFixtureFile(
    join(localSource, "in-app-only", "SKILL.md"),
    `---
name: in-app-only
description: In-app-only workflow
---

# In-app only
`,
  );

  return { root, source, localSource, destination };
}

test("uses an explicit canonical allowlist", () => {
  expect(CANONICAL_SKILLS).toEqual([
    "feature-flags",
    "experiments",
    "analytics",
  ]);
  expect(CANONICAL_SKILLS).not.toContain("gb-setup");
});

test("rejects local skills that shadow canonical skills", () => {
  expect(() =>
    assertNoSkillNameCollision("analytics", new Set(CANONICAL_SKILLS)),
  ).toThrow(/collides with an allowlisted canonical skill/);
  expect(() =>
    assertNoSkillNameCollision("growthbook-docs", new Set(CANONICAL_SKILLS)),
  ).not.toThrow();
});

test("assembles the canonical tree and standalone local skills", () => {
  const fixture = createSkillsFixture();
  try {
    bundleSkills({
      source: fixture.source,
      localSource: fixture.localSource,
      destination: fixture.destination,
      ci: true,
    });

    for (const domain of CANONICAL_SKILLS) {
      expect(existsSync(join(fixture.destination, domain, "SKILL.md"))).toBe(
        true,
      );
      expect(
        existsSync(
          join(fixture.destination, domain, "references", "shared.md"),
        ),
      ).toBe(true);
      expect(
        readFileSync(join(fixture.destination, domain, "SKILL.md"), "utf8"),
      ).toBe(`---
name: ${domain}
description: ${domain} workflows
---

Read \`references/shared.md\`.
`);
    }
    expect(
      existsSync(join(fixture.destination, "in-app-only", "SKILL.md")),
    ).toBe(true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
