#!/usr/bin/env node

// Assembles the in-app assistant's skills from growthbook/skills plus the
// checked-in skills-local tree. Dependency-free because CI runs this before
// pnpm install.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const outputDir = join(packageRoot, "generated", "agent-skills");
const localSkillsDir = join(packageRoot, "src", "agent", "skills-local");

const SKILLS_REPOSITORY = "https://github.com/growthbook/skills";
export const CANONICAL_SKILLS = ["feature-flags", "experiments", "analytics"];

function rewriteReferencePaths(content, entrypoint) {
  const loadSkill = (name) =>
    `\`loadSkill('${entrypoint}/references/${name}')\``;
  const adapted = content
    .replace(
      /\[[^\]\r\n]+\]\(references\/([a-z0-9-]+)\.md\)/g,
      (_match, name) => loadSkill(name),
    )
    .replace(/`references\/([a-z0-9-]+)\.md`/g, (_match, name) =>
      loadSkill(name),
    )
    .replace(/references\/([a-z0-9-]+)\.md/g, (_match, name) =>
      loadSkill(name),
    );
  const remaining = adapted.match(/references\/[^`'"\s)]+\.md/);
  if (remaining) {
    throw new Error(
      `Could not convert workflow reference "${remaining[0]}" in canonical skill "${entrypoint}".`,
    );
  }
  return adapted;
}

export function adaptCanonicalSkill(content, name, entrypoint = name) {
  return rewriteReferencePaths(content, entrypoint);
}

function isSkillsCheckout(dir) {
  return existsSync(join(dir, "skills"));
}

const SIBLING_CANDIDATES = [
  resolve(repoRoot, "..", "skills"),
  resolve(repoRoot, "..", "..", "skills"),
];

function resolveSkillsSource() {
  if (process.env.SKILLS_SRC) {
    const explicit = resolve(process.env.SKILLS_SRC);
    if (!isSkillsCheckout(explicit)) {
      throw new Error(
        `SKILLS_SRC is set to ${explicit}, which has no skills/ directory. Point it at a ${SKILLS_REPOSITORY} checkout.`,
      );
    }
    return explicit;
  }
  return SIBLING_CANDIDATES.find(isSkillsCheckout) ?? null;
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
}

function copyCanonicalSkill(source, skillName, destination) {
  const sourceDir = join(source, "skills", skillName);
  const skillFile = join(sourceDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(
      `Allowlisted canonical skill "${skillName}" has no SKILL.md in ${sourceDir}.`,
    );
  }

  const destinationDir = join(destination, skillName);
  mkdirSync(destinationDir, { recursive: true });
  writeFileSync(
    join(destinationDir, "SKILL.md"),
    adaptCanonicalSkill(readFileSync(skillFile, "utf8"), skillName, skillName),
    "utf8",
  );

  const referencesDir = join(sourceDir, "references");
  const references = markdownFiles(referencesDir);
  if (references.length > 0) {
    const destinationReferences = join(destinationDir, "references");
    mkdirSync(destinationReferences, { recursive: true });
    for (const file of references) {
      const name = basename(file, ".md");
      writeFileSync(
        join(destinationReferences, file),
        adaptCanonicalSkill(
          readFileSync(join(referencesDir, file), "utf8"),
          name,
          skillName,
        ),
        "utf8",
      );
    }
  }
}

export function assertNoSkillNameCollision(name, canonicalNames) {
  if (canonicalNames.has(name)) {
    throw new Error(
      `Local skill "${name}" collides with an allowlisted canonical skill.`,
    );
  }
}

function copyLocalSkills(sourceRoot, destination, canonicalNames) {
  if (!existsSync(sourceRoot)) return [];

  const copied = [];
  for (const name of readdirSync(sourceRoot).sort()) {
    const sourceDir = join(sourceRoot, name);
    if (!statSync(sourceDir).isDirectory()) continue;
    assertNoSkillNameCollision(name, canonicalNames);

    const skillFile = join(sourceDir, "SKILL.md");
    if (!existsSync(skillFile)) {
      throw new Error(`Local skill "${name}" has no SKILL.md in ${sourceDir}.`);
    }

    const destinationDir = join(destination, name);
    mkdirSync(destinationDir, { recursive: true });
    writeFileSync(
      join(destinationDir, "SKILL.md"),
      readFileSync(skillFile, "utf8"),
      "utf8",
    );

    const referencesDir = join(sourceDir, "references");
    const references = markdownFiles(referencesDir);
    if (references.length > 0) {
      const destinationReferences = join(destinationDir, "references");
      mkdirSync(destinationReferences, { recursive: true });
      for (const file of references) {
        writeFileSync(
          join(destinationReferences, file),
          readFileSync(join(referencesDir, file), "utf8"),
          "utf8",
        );
      }
    }
    copied.push(name);
  }
  return copied;
}

export function validateLoadSkillTargets(dir) {
  const targets = new Set();
  const markdown = [];

  for (const entrypoint of readdirSync(dir).sort()) {
    const skillDir = join(dir, entrypoint);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    targets.add(entrypoint);
    markdown.push(skillFile);

    const referencesDir = join(skillDir, "references");
    for (const file of markdownFiles(referencesDir)) {
      targets.add(`${entrypoint}/references/${basename(file, ".md")}`);
      markdown.push(join(referencesDir, file));
    }
  }

  for (const file of markdown) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/loadSkill\('([^']+)'\)/g)) {
      if (!targets.has(match[1])) {
        throw new Error(
          `Generated skill ${file} references missing loadSkill target "${match[1]}".`,
        );
      }
    }
  }
}

export function bundleSkills({
  source = resolveSkillsSource(),
  destination = outputDir,
  localSource = localSkillsDir,
  canonicalSkills = CANONICAL_SKILLS,
  ci = Boolean(process.env.CI && process.env.CI !== "false"),
} = {}) {
  const reusableBundle =
    !source &&
    canonicalSkills.every((name) =>
      existsSync(join(destination, name, "SKILL.md")),
    );
  if (!source && ci) {
    throw new Error(
      `No ${SKILLS_REPOSITORY} checkout found in CI. Set SKILLS_SRC to the checkout root.`,
    );
  }
  if (!source) {
    process.stderr.write(
      `Skipping canonical agent skills: no ${SKILLS_REPOSITORY} checkout found.\n` +
        `Looked for $SKILLS_SRC, ${SIBLING_CANDIDATES.join(", and ")}.\n` +
        (reusableBundle
          ? `Reusing the existing canonical assembly and refreshing local skills.\n`
          : `Local-only skills will still be assembled.\n`),
    );
  }

  const temporaryDir = `${destination}.tmp-${process.pid}`;
  rmSync(temporaryDir, { recursive: true, force: true });
  mkdirSync(temporaryDir, { recursive: true });

  try {
    if (source) {
      for (const skillName of canonicalSkills) {
        copyCanonicalSkill(source, skillName, temporaryDir);
      }
    } else if (reusableBundle) {
      for (const skillName of canonicalSkills) {
        cpSync(join(destination, skillName), join(temporaryDir, skillName), {
          recursive: true,
        });
      }
    }
    const localSkills = copyLocalSkills(
      localSource,
      temporaryDir,
      new Set(canonicalSkills),
    );
    validateLoadSkillTargets(temporaryDir);

    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(temporaryDir, destination);

    process.stdout.write(
      `Assembled ${source || reusableBundle ? canonicalSkills.length : 0} canonical and ${localSkills.length} local agent skill(s) into ${destination}\n`,
    );
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    bundleSkills();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
