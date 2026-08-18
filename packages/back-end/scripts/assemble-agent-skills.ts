#!/usr/bin/env node

// Assembles the in-app assistant's skills from growthbook/skills plus the
// checked-in skills-local tree.

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
import { dirname, join, resolve } from "node:path";

const scriptDir = __dirname;
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const outputDir = join(packageRoot, "generated", "agent-skills");
const localSkillsDir = join(packageRoot, "src", "agent", "skills-local");

const SKILLS_REPOSITORY = "https://github.com/growthbook/skills";
export const CANONICAL_SKILLS = [
  "feature-flags",
  "experiments",
  "analytics",
] as const;

function isSkillsCheckout(dir: string): boolean {
  return existsSync(join(dir, "skills"));
}

const SIBLING_CANDIDATES = [
  resolve(repoRoot, "..", "skills"),
  resolve(repoRoot, "..", "..", "skills"),
];

function resolveSkillsSource(): string | null {
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

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
}

function copySkillDirectory(
  sourceDir: string,
  skillName: string,
  destination: string,
  sourceLabel: string,
): void {
  const skillFile = join(sourceDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(
      `${sourceLabel} skill "${skillName}" has no SKILL.md in ${sourceDir}.`,
    );
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

export function assertNoSkillNameCollision(
  name: string,
  canonicalNames: ReadonlySet<string>,
): void {
  if (canonicalNames.has(name)) {
    throw new Error(
      `Local skill "${name}" collides with an allowlisted canonical skill.`,
    );
  }
}

function copyLocalSkills(
  sourceRoot: string,
  destination: string,
  canonicalNames: ReadonlySet<string>,
): string[] {
  if (!existsSync(sourceRoot)) return [];
  const copied: string[] = [];
  for (const name of readdirSync(sourceRoot).sort()) {
    const sourceDir = join(sourceRoot, name);
    if (!statSync(sourceDir).isDirectory()) continue;
    assertNoSkillNameCollision(name, canonicalNames);
    copySkillDirectory(sourceDir, name, destination, "Local");
    copied.push(name);
  }
  return copied;
}

interface AssembleSkillsOptions {
  source?: string | null;
  destination?: string;
  localSource?: string;
  canonicalSkills?: readonly string[];
  ci?: boolean;
}

export function assembleSkills({
  source = resolveSkillsSource(),
  destination = outputDir,
  localSource = localSkillsDir,
  canonicalSkills = CANONICAL_SKILLS,
  ci = Boolean(process.env.CI && process.env.CI !== "false"),
}: AssembleSkillsOptions = {}): void {
  const reusableAssembly =
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
        (reusableAssembly
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
        copySkillDirectory(
          join(source, "skills", skillName),
          skillName,
          temporaryDir,
          "Allowlisted canonical",
        );
      }
    } else if (reusableAssembly) {
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

    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(temporaryDir, destination);

    process.stdout.write(
      `Assembled ${source || reusableAssembly ? canonicalSkills.length : 0} canonical and ${localSkills.length} local agent skill(s) into ${destination}\n`,
    );
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  try {
    assembleSkills();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
