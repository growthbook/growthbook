import fs from "fs";
import path from "path";
import { logger } from "back-end/src/util/logger";

/**
 * Agent skills teach the generic agent how to use slices of the GrowthBook
 * REST API via the `callApi` tool.
 *
 * This module is the loader; the skill content lives in the sibling `skills/`
 * directory as plain markdown (copied verbatim into `dist/agent/skills` at
 * build time by the `build:skills` script).
 *
 * Layout (one level deep):
 *
 *   skills.ts                          # this loader
 *   skills/
 *     product-analytics.md          # standalone domain (no children)
 *     feature-flags/
 *       SKILL.md                    # domain router (name: feature-flags)
 *       flag-create.md              # leaf (group: feature-flags)
 *       ...
 *
 * Domain routers appear in the system-prompt index; leaves are loaded on
 * demand after the model reads the router's child map.
 */

export type SkillKind = "domain" | "leaf";

export interface Skill {
  name: string;
  description: string;
  body: string;
  kind: SkillKind;
  /** Parent domain name for leaf skills; equals `name` for domain routers. */
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
    if (entry.endsWith(".md")) return true;
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
    // Compiled (dist/agent/skills.js -> dist/agent/skills) and tests run from
    // source (src/agent/skills.ts -> src/agent/skills) both resolve here.
    path.join(__dirname, "skills"),
    // Fallback to source when running compiled code in the repo layout
    // (dist/agent -> packages/back-end/src/agent/skills).
    path.resolve(__dirname, "..", "..", "src", "agent", "skills"),
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
): Skill {
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const name = data.name || path.basename(fileLabel, ".md");
  const description = data.description || "";
  if (!description) {
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

    if (entry.endsWith(".md") && fs.statSync(fullPath).isFile()) {
      // Top-level markdown without frontmatter is documentation, not a
      // routable skill — skip it so it never lands in the system-prompt index.
      if (!FRONTMATTER_RE.test(fs.readFileSync(fullPath, "utf8"))) {
        continue;
      }
      const skill = parseSkillFile(fullPath, entry, "domain");
      if (seenNames.has(skill.name)) {
        logger.warn(
          `Duplicate skill name "${skill.name}" in ${entry}; skipping.`,
        );
        continue;
      }
      seenNames.add(skill.name);
      skills.push(skill);
      continue;
    }

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
    domainSkill.group = domainSkill.name;
    skills.push(domainSkill);

    for (const leafFile of fs.readdirSync(fullPath).sort()) {
      if (!leafFile.endsWith(".md") || leafFile === "SKILL.md") continue;
      const leafPath = path.join(fullPath, leafFile);
      if (!fs.statSync(leafPath).isFile()) continue;

      const leaf = parseSkillFile(
        leafPath,
        `${entry}/${leafFile}`,
        "leaf",
        domainSkill.name,
      );
      if (seenNames.has(leaf.name)) {
        logger.warn(
          `Duplicate skill name "${leaf.name}" in ${entry}/${leafFile}; skipping.`,
        );
        continue;
      }
      seenNames.add(leaf.name);
      skills.push(leaf);
    }
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
