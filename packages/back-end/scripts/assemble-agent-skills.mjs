#!/usr/bin/env node

// Assembles the in-app assistant's skills from growthbook/skills plus the
// checked-in skills-local tree. Canonical checkout, in order: $SKILLS_SRC,
// agent-skills.local.json (gitignored; path relative to the repo root), then
// skills-src/. Neighbor directories named "skills" are not probed.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const SCRIPT_SUBPATH = join("scripts", "assemble-agent-skills.mjs");

function resolveEntryPath() {
  return process.argv[1] ? resolve(process.argv[1]) : null;
}

function resolvePackageRoot() {
  const entry = resolveEntryPath();
  const candidates = [
    ...(entry ? [resolve(dirname(entry), "..")] : []),
    process.cwd(),
    resolve(process.cwd(), "packages", "back-end"),
  ];
  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "src", "agent", "skills-local")),
  );
  if (!root) {
    throw new Error(
      "Run assemble-agent-skills from the repository root or packages/back-end.",
    );
  }
  return root;
}

const packageRoot = resolvePackageRoot();
const repoRoot = resolve(packageRoot, "..", "..");
const outputDir = join(packageRoot, "generated", "agent-skills");
const localSkillsDir = join(packageRoot, "src", "agent", "skills-local");

const SKILLS_REPOSITORY = "https://github.com/growthbook/skills";
const CANONICAL_SKILLS = ["feature-flags", "experiments", "analytics"];
const LOCAL_CONFIG_NAME = "agent-skills.local.json";
const localConfigPath = join(packageRoot, LOCAL_CONFIG_NAME);
const skillsSrcDir = resolve(repoRoot, "skills-src");

function isSkillsCheckout(dir) {
  return existsSync(join(dir, "skills"));
}

function warnInvalidCheckout(label, dir) {
  process.stderr.write(
    `Warning: ${label} is ${dir}, which has no skills/ directory. Point it at a ${SKILLS_REPOSITORY} checkout. Skipping canonical skills.\n`,
  );
  return null;
}

function checkoutAt(label, dir) {
  if (!isSkillsCheckout(dir)) {
    return warnInvalidCheckout(label, dir);
  }
  return dir;
}

function pathFromLocalConfig(configPath) {
  try {
    const pathValue = JSON.parse(readFileSync(configPath, "utf8")).path;
    if (typeof pathValue === "string" && pathValue.trim() !== "") {
      return pathValue.trim();
    }
  } catch {
    // Invalid JSON or unexpected shape; warn below.
  }
  process.stderr.write(
    `Warning: ${configPath} must be { "path": "<growthbook/skills checkout>" } relative to the repository root. Skipping canonical skills.\n`,
  );
  return null;
}

function resolveSkillsSource() {
  if (process.env.SKILLS_SRC) {
    return checkoutAt("$SKILLS_SRC", resolve(process.env.SKILLS_SRC));
  }
  if (existsSync(localConfigPath)) {
    const pathValue = pathFromLocalConfig(localConfigPath);
    return pathValue
      ? checkoutAt(localConfigPath, resolve(repoRoot, pathValue))
      : null;
  }
  if (isSkillsCheckout(skillsSrcDir)) {
    return skillsSrcDir;
  }
  return null;
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
}

function copySkillDirectory(sourceDir, skillName, destination, sourceLabel) {
  const skillFile = join(sourceDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    process.stderr.write(
      `Warning: ${sourceLabel} skill "${skillName}" has no SKILL.md in ${sourceDir}. Skipping.\n`,
    );
    return;
  }

  const destinationDir = join(destination, skillName);
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
}

function copyLocalSkills(sourceRoot, destination, canonicalNames) {
  if (!existsSync(sourceRoot)) return [];
  const copied = [];
  for (const name of readdirSync(sourceRoot).sort()) {
    const sourceDir = join(sourceRoot, name);
    if (!statSync(sourceDir).isDirectory()) continue;
    if (canonicalNames.has(name)) {
      process.stderr.write(
        `Warning: Local skill "${name}" collides with an allowlisted canonical skill. Skipping local version.\n`,
      );
      continue;
    }
    copySkillDirectory(sourceDir, name, destination, "Local");
    copied.push(name);
  }
  return copied;
}

function assembleSkills() {
  const source = resolveSkillsSource();
  const pointedExplicitly =
    Boolean(process.env.SKILLS_SRC) || existsSync(localConfigPath);
  if (!source && !pointedExplicitly) {
    process.stderr.write(
      `Warning: Skipping canonical agent skills: no ${SKILLS_REPOSITORY} checkout found.\n` +
        `Point at one with ${LOCAL_CONFIG_NAME} (gitignored; see ${LOCAL_CONFIG_NAME}.example) or $SKILLS_SRC. CI/Docker use skills-src.\n` +
        `Local-only skills will still be assembled.\n`,
    );
  }

  const temporaryDir = `${outputDir}.tmp-${process.pid}`;
  rmSync(temporaryDir, { recursive: true, force: true });
  mkdirSync(temporaryDir, { recursive: true });

  try {
    if (source) {
      for (const skillName of CANONICAL_SKILLS) {
        copySkillDirectory(
          join(source, "skills", skillName),
          skillName,
          temporaryDir,
          "Allowlisted canonical",
        );
      }
    }
    const localSkills = copyLocalSkills(
      localSkillsDir,
      temporaryDir,
      new Set(CANONICAL_SKILLS),
    );

    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(dirname(outputDir), { recursive: true });
    renameSync(temporaryDir, outputDir);

    process.stdout.write(
      `Assembled ${source ? CANONICAL_SKILLS.length : 0} canonical and ${localSkills.length} local agent skill(s) into ${outputDir}\n`,
    );
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

const entryPath = resolveEntryPath();
if (entryPath?.endsWith(SCRIPT_SUBPATH)) {
  try {
    assembleSkills();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
