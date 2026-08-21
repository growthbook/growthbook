import fs from "fs";
import path from "path";
import type { SkillSummary } from "shared/ai-chat";
import { logger } from "back-end/src/util/logger";

/**
 * Agent skills teach the generic agent how to use slices of the GrowthBook
 * REST API via the `callApi` tool.
 *
 * This module is the loader; the content is assembled at build time into
 * `generated/agent-skills` from a growthbook/skills checkout plus the
 * in-app-only `skills-local` tree (see `scripts/assemble-agent-skills.mjs`).
 *
 * Layout (one level deep):
 *
 *   generated/agent-skills/
 *     growthbook-docs/
 *       SKILL.md                  # standalone domain, no workflows
 *     feature-flags/
 *       SKILL.md                  # domain router (name: feature-flags)
 *       references/
 *         flag-create.md          # workflow, qualified as
 *                                 # feature-flags/references/flag-create
 *
 * Domain routers appear in the system-prompt index and the composer's
 * slash-command menu; workflows load on demand once the model has read the
 * router's workflow table.
 */

/** A skill's index entry plus the prompt body only the agent reads. */
export interface Skill extends SkillSummary {
  body: string;
}

interface SkillRegistry {
  /** Index entries for domains and workflows, in menu order. */
  summaries: SkillSummary[];
  skills: Map<string, Skill>;
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
    path.join(__dirname, "skills"),
    path.resolve(__dirname, "..", "..", "generated", "agent-skills"),
  ];
  return candidates.find(skillsDirHasContent) ?? null;
}

function readMarkdownFile(fullPath: string) {
  return parseFrontmatter(fs.readFileSync(fullPath, "utf8"));
}

function readDomainSkill(
  skillsDir: string,
  directoryName: string,
): Skill | null {
  const domainDir = path.join(skillsDir, directoryName);
  if (!fs.statSync(domainDir).isDirectory()) return null;

  const routerPath = path.join(domainDir, "SKILL.md");
  if (!fs.existsSync(routerPath)) return null;

  const { data: frontmatter, body } = readMarkdownFile(routerPath);
  const name = frontmatter.name || directoryName;
  const domain: Skill = {
    name,
    description: frontmatter.description || "",
    body: body.trim(),
    kind: "domain",
    group: name,
  };
  if (!domain.description) {
    logger.warn(
      `Skill ${directoryName}/SKILL.md is missing a 'description' frontmatter field; agents won't know when to use it.`,
    );
  }
  return domain;
}

function readReferenceSkills(
  skillsDir: string,
  directoryName: string,
  domainName: string,
): Skill[] | null {
  const referencesDir = path.join(skillsDir, directoryName, "references");
  if (
    !fs.existsSync(referencesDir) ||
    !fs.statSync(referencesDir).isDirectory()
  ) {
    return null;
  }

  const references: Skill[] = [];
  const files = fs
    .readdirSync(referencesDir)
    .filter((file) => file.endsWith(".md"))
    .sort();

  for (const file of files) {
    const referencePath = path.join(referencesDir, file);
    if (!fs.statSync(referencePath).isFile()) continue;

    const name = `${domainName}/references/${path.basename(file, ".md")}`;
    const { data: frontmatter, body } = readMarkdownFile(referencePath);
    references.push({
      name,
      description: frontmatter.description || "",
      body: body.trim(),
      kind: "leaf",
      group: domainName,
    });
  }
  return references;
}

function toSummary({ name, description, kind, group }: Skill): SkillSummary {
  return { name, description, kind, ...(group === undefined ? {} : { group }) };
}

let cachedRegistry: SkillRegistry | null = null;

function loadSkillsFromDirectory(dir: string | null): SkillRegistry {
  if (!dir) {
    logger.warn(
      `No skills directory found near ${__dirname}; the generic agent will run without skill instructions.`,
    );
    return { summaries: [], skills: new Map() };
  }

  const summaries: SkillSummary[] = [];
  const skills = new Map<string, Skill>();

  for (const entry of fs.readdirSync(dir).sort()) {
    const domain = readDomainSkill(dir, entry);
    if (!domain) continue;

    if (skills.has(domain.name)) {
      logger.warn(
        `Duplicate skill name "${domain.name}" in ${entry}/SKILL.md; skipping domain.`,
      );
      continue;
    }
    summaries.push(toSummary(domain));
    skills.set(domain.name, domain);

    const domainReferences = readReferenceSkills(dir, entry, domain.name);
    if (domainReferences === null) continue;
    if (domainReferences.length === 0) {
      logger.warn(
        `Skill domain "${domain.name}" has no workflows. Run 'pnpm --filter back-end assemble:skills' with a growthbook/skills checkout; see packages/back-end/src/agent/AGENT_SKILLS.md.`,
      );
    }
    for (const reference of domainReferences) {
      skills.set(reference.name, reference);
      summaries.push(toSummary(reference));
    }
  }

  const names = [...skills.keys()];
  const domainCount = summaries.filter((s) => s.kind === "domain").length;
  logger.info(
    `Loaded ${names.length} agent skill(s) from ${dir} (${domainCount} domain, ${names.length - domainCount} reference): ${names.join(", ")}`,
  );
  return { summaries, skills };
}

function getSkillRegistry(): SkillRegistry {
  if (!cachedRegistry) {
    cachedRegistry = loadSkillsFromDirectory(resolveSkillsDir());
  }
  return cachedRegistry;
}

export const _loadSkillsFromDirectory = loadSkillsFromDirectory;

/** Domain routers only — the compact index inlined into the system prompt. */
export function listDomainSkills(): readonly SkillSummary[] {
  return getSkillRegistry().summaries.filter((s) => s.kind === "domain");
}

/** Domains and workflows — the composer's slash-command menu lists both. */
export function listSkillSummaries(): readonly SkillSummary[] {
  return getSkillRegistry().summaries;
}

export function readSkill(name: string): Skill | undefined {
  return getSkillRegistry().skills.get(name);
}
