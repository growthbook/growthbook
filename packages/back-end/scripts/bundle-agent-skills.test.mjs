import assert from "node:assert/strict";
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
import test from "node:test";
import {
  adaptCanonicalSkill,
  assertNoSkillNameCollision,
  bundleSkills,
  CANONICAL_SKILLS,
} from "./bundle-agent-skills.mjs";

function writeFixtureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSkillsFixture({ missingReference = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-"));
  const source = join(root, "canonical");
  const localSource = join(root, "local");
  const destination = join(root, "generated", "agent-skills");

  for (const domain of CANONICAL_SKILLS) {
    const reference =
      missingReference && domain === "feature-flags" ? "missing" : "shared";
    writeFixtureFile(
      join(source, "skills", domain, "SKILL.md"),
      `---
name: ${domain}
description: ${domain} workflows
---

Read \`references/${reference}.md\`.
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
  assert.deepEqual(CANONICAL_SKILLS, [
    "feature-flags",
    "experiments",
    "analytics",
  ]);
  assert.equal(CANONICAL_SKILLS.includes("gb-setup"), false);
});

test("preserves canonical content while adapting routing", () => {
  const content = `---
name: analytics
description: Chart data. For first-time API key configuration, use gb-setup.
allowed-tools: Bash(gb-call *)
---

All API calls go through the bundled helper. It reads GB_API_KEY from the environment and falls back to a file written by **gb-setup**.

Read \`references/analytics-explore.md\`.

- **gb-setup** — configure credentials.
`;
  const adapted = adaptCanonicalSkill(content, "analytics");

  assert.match(
    adapted,
    /loadSkill\('analytics\/references\/analytics-explore'\)/,
  );
  assert.match(adapted, /allowed-tools: Bash\(gb-call \*\)/);
  assert.match(adapted, /gb-setup/);
  assert.doesNotMatch(adapted, /In-app assistant note/);
});

test("qualifies identical reference names by domain", () => {
  const content = "Read `references/shared-workflow.md`.";

  assert.match(
    adaptCanonicalSkill(content, "first", "first-domain"),
    /loadSkill\('first-domain\/references\/shared-workflow'\)/,
  );
  assert.match(
    adaptCanonicalSkill(content, "second", "second-domain"),
    /loadSkill\('second-domain\/references\/shared-workflow'\)/,
  );
});

test("rewrites inline code, Markdown links, and plain workflow paths", () => {
  const content = [
    "Read `references/first.md`.",
    "Then [the second workflow](references/second.md).",
    "Finally see references/third.md.",
  ].join("\n");
  const adapted = adaptCanonicalSkill(content, "router", "domain");

  assert.match(adapted, /loadSkill\('domain\/references\/first'\)/);
  assert.match(adapted, /loadSkill\('domain\/references\/second'\)/);
  assert.match(adapted, /loadSkill\('domain\/references\/third'\)/);
  assert.doesNotMatch(adapted, /references\/[^'"]+\.md/);
});

test("preserves workflow-specific runtime instructions", () => {
  const content = `---
name: analytics-explore
description: Run a chart
---

- \`"running"\` → wait (\`sleep 10\`), then re-POST.
`;
  const adapted = adaptCanonicalSkill(content, "analytics-explore");

  assert.match(adapted, /wait \(`sleep 10`\), then re-POST/);
});

test("rejects local skills that shadow canonical skills", () => {
  assert.throws(
    () => assertNoSkillNameCollision("analytics", new Set(CANONICAL_SKILLS)),
    /collides with an allowlisted canonical skill/,
  );
  assert.doesNotThrow(() =>
    assertNoSkillNameCollision("growthbook-docs", new Set(CANONICAL_SKILLS)),
  );
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
      assert.equal(
        existsSync(join(fixture.destination, domain, "SKILL.md")),
        true,
      );
      assert.equal(
        existsSync(
          join(fixture.destination, domain, "references", "shared.md"),
        ),
        true,
      );
      assert.match(
        readFileSync(join(fixture.destination, domain, "SKILL.md"), "utf8"),
        new RegExp(`loadSkill\\('${domain}/references/shared'\\)`),
      );
    }
    assert.equal(
      existsSync(join(fixture.destination, "in-app-only", "SKILL.md")),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails assembly when a generated loadSkill target is missing", () => {
  const fixture = createSkillsFixture({ missingReference: true });
  try {
    assert.throws(
      () =>
        bundleSkills({
          source: fixture.source,
          localSource: fixture.localSource,
          destination: fixture.destination,
          ci: true,
        }),
      /references missing loadSkill target "feature-flags\/references\/missing"/,
    );
    assert.equal(existsSync(fixture.destination), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
