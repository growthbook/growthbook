import fs from "fs";
import path from "path";
import { logger } from "back-end/src/util/logger";

/**
 * Agent skills teach the generic agent how to use slices of the GrowthBook
 * REST API via the `callApi` tool.
 *
 * `bundle:skills` assembles canonical and in-app-only skills under
 * `generated/agent-skills`; `build:skills` copies that tree beside this module
 * in `dist`.
 *
 * Layout:
 *
 *   skills.ts                          # this loader
 *   skills/
 *     feature-flags/
 *       SKILL.md
 *       references/
 *         flag-create.md
 *       ...
 *     growthbook-docs/
 *       SKILL.md                    # in-app-only standalone domain
 *
 * Domain routers appear in the system-prompt index; leaves are loaded on
 * demand after the model reads the router's child map.
 */

export type SkillKind = "domain" | "leaf";

export interface Skill {
  /** Domain name, or a qualified `<domain>/references/<leaf>` path. */
  name: string;
  description: string;
  body: string;
  kind: SkillKind;
  /** Parent domain for leaves; set on routers that have references. */
  group?: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { data: {}, body: raw };
  }
  const yamlish = match[1];
  const body = raw.slice(match[0].length);

  const data: Record<string, string> = {};
  for (const line of yamlish.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valueRaw = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    const value = valueRaw.replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, body };
}

function skillsDirHasContent(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return false;
  }
  for (const entry of fs.readdirSync(dir)) {
    const child = path.join(dir, entry);
    if (
      fs.statSync(child).isDirectory() &&
      fs.existsSync(path.join(child, "SKILL.md"))
    ) {
      return true;
    }
  }
  return false;
}

function resolveSkillsDir(): string | null {
  const candidates = [
    // Compiled code resolves to dist/agent/skills.
    path.join(__dirname, "skills"),
    // Tests and local development read the build-time assembly directly.
    path.resolve(__dirname, "..", "..", "generated", "agent-skills"),
  ];
  for (const dir of candidates) {
    if (skillsDirHasContent(dir)) {
      return dir;
    }
  }
  return null;
}

function parseSkillFile(
  fullPath: string,
  fileLabel: string,
  kind: SkillKind,
  group?: string,
  qualifiedName?: string,
): Skill {
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const name = qualifiedName || data.name || path.basename(fileLabel, ".md");
  const description = data.description || "";
  if (kind === "domain" && !description) {
    logger.warn(
      `Skill ${fileLabel} is missing a 'description' frontmatter field; agents won't know when to use it.`,
    );
  }
  return {
    name,
    description,
    body: body.trim(),
    kind,
    ...(group !== undefined ? { group } : {}),
  };
}

let cachedSkills: Skill[] | null = null;

function loadSkillsFromDisk(): Skill[] {
  const dir = resolveSkillsDir();
  if (!dir) {
    logger.warn(
      `No skills directory found near ${__dirname}; the generic agent will run without skill instructions.`,
    );
    return [];
  }

  const skills: Skill[] = [];
  const seenNames = new Set<string>();

  for (const entry of fs.readdirSync(dir).sort()) {
    const fullPath = path.join(dir, entry);

    if (!fs.statSync(fullPath).isDirectory()) continue;

    const routerPath = path.join(fullPath, "SKILL.md");
    if (!fs.existsSync(routerPath)) continue;

    const domainSkill = parseSkillFile(
      routerPath,
      `${entry}/SKILL.md`,
      "domain",
    );
    if (seenNames.has(domainSkill.name)) {
      logger.warn(
        `Duplicate skill name "${domainSkill.name}" in ${entry}/SKILL.md; skipping domain.`,
      );
      continue;
    }
    seenNames.add(domainSkill.name);
    const referencesDir = path.join(fullPath, "references");
    if (
      fs.existsSync(referencesDir) &&
      fs.statSync(referencesDir).isDirectory()
    ) {
      domainSkill.group = domainSkill.name;
    }
    skills.push(domainSkill);

    if (domainSkill.group === undefined) continue;

    for (const leafFile of fs.readdirSync(referencesDir).sort()) {
      if (!leafFile.endsWith(".md")) continue;
      const leafPath = path.join(referencesDir, leafFile);
      if (!fs.statSync(leafPath).isFile()) continue;

      const leaf = parseSkillFile(
        leafPath,
        `${entry}/references/${leafFile}`,
        "leaf",
        domainSkill.name,
        `${entry}/references/${path.basename(leafFile, ".md")}`,
      );
      if (seenNames.has(leaf.name)) {
        logger.warn(
          `Duplicate skill name "${leaf.name}" in ${entry}/references/${leafFile}; skipping.`,
        );
        continue;
      }
      seenNames.add(leaf.name);
      skills.push(leaf);
    }
  }

  // A canonical router with an empty references directory advertises workflows
  // the agent cannot load.
  for (const router of skills) {
    if (router.kind !== "domain" || router.group === undefined) continue;
    if (skills.some((s) => s.kind === "leaf" && s.group === router.name)) {
      continue;
    }
    logger.warn(
      `Skill domain "${router.name}" has no workflows. Run 'pnpm --filter back-end bundle:skills' with a growthbook/skills checkout; see packages/back-end/src/agent/AGENT_SKILLS.md.`,
    );
  }

  const domainCount = skills.filter((s) => s.kind === "domain").length;
  const leafCount = skills.filter((s) => s.kind === "leaf").length;
  logger.info(
    `Loaded ${skills.length} agent skill(s) from ${dir} (${domainCount} domain, ${leafCount} leaf): ${skills
      .map((s) => s.name)
      .join(", ")}`,
  );
  return skills;
}

export function getAllSkills(): Skill[] {
  if (!cachedSkills) {
    cachedSkills = loadSkillsFromDisk();
  }
  return cachedSkills;
}

export function getSkillByName(name: string): Skill | undefined {
  return getAllSkills().find((s) => s.name === name);
}

export function getDomainSkills(): Skill[] {
  return getAllSkills().filter((s) => s.kind === "domain");
}

export function getLeafSkillsForDomain(domainName: string): Skill[] {
  return getAllSkills().filter(
    (s) => s.kind === "leaf" && s.group === domainName,
  );
}

/**
 * Compact index for the system prompt: domain routers only.
 * Leaf bodies load on demand via `loadSkill` after reading the router.
 */
export function assembleSkillsIndexForPrompt(): string {
  const domains = getDomainSkills();
  if (!domains.length) return "";
  return domains
    .map((s) => `- **${s.name}** — ${s.description || "(no description)"}`)
    .join("\n");
}

/** Names of all loaded skills (domains and leaves), for tool error messages. */
export function getSkillNames(): string[] {
  return getAllSkills().map((s) => s.name);
}

/** Test-only: clears the cached skills so a fresh read happens next call. */
export function _clearSkillCacheForTests(): void {
  cachedSkills = null;
}
