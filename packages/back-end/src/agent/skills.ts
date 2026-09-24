import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { SkillSummary } from "shared/ai-chat";
import { logger } from "back-end/src/util/logger";
import {
  AGENT_SKILLS_DIR,
  AGENT_SKILLS_DISABLE_BUILTINS,
} from "back-end/src/util/secrets";

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
 *
 * Self-hosted installs can add skills in the same layout from
 * `AGENT_SKILLS_DIR` and drop built-ins with `AGENT_SKILLS_DISABLE_BUILTINS`.
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

  try {
    const parsed: unknown = yaml.load(yamlish);
    if (parsed && typeof parsed === "object") {
      const data: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") data[key] = value.trim();
      }
      return { data, body };
    }
  } catch {
    // Hand-written frontmatter often isn't valid YAML; fall back to one key per line.
  }

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
    if (!frontmatter.description) {
      logger.warn(
        `Skill ${directoryName}/references/${file} is missing a 'description' frontmatter field; it will only be findable by name in the skill menu.`,
      );
    }
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
        `Skill domain "${domain.name}" has no workflows. Run 'pnpm --filter back-end assemble-skills' with a growthbook/skills checkout; see packages/back-end/src/agent/README.md.`,
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

/**
 * Layers a self-hosted install's own skills over the built-ins. A custom domain
 * replaces the built-in of the same name, workflows included, and `disabled`
 * ("all" or domain names) drops built-ins outright.
 */
function mergeCustomSkills(
  builtIn: SkillRegistry,
  custom: SkillRegistry,
  disabled: "all" | ReadonlySet<string>,
): SkillRegistry {
  const customDomains = new Set(
    custom.summaries.filter((s) => s.kind === "domain").map((s) => s.name),
  );
  const builtInDomains = builtIn.summaries.filter((s) => s.kind === "domain");
  for (const { name } of builtInDomains) {
    if (customDomains.has(name)) {
      logger.info(`Custom agent skill "${name}" overrides the built-in one.`);
    }
  }
  if (disabled !== "all") {
    for (const name of disabled) {
      if (!builtInDomains.some((s) => s.name === name)) {
        logger.warn(
          `AGENT_SKILLS_DISABLE_BUILTINS names "${name}", which is not a built-in skill.`,
        );
      }
    }
  }

  const keep = ({ name, group }: SkillSummary) => {
    const domain = group ?? name;
    return !(
      disabled === "all" ||
      disabled.has(domain) ||
      customDomains.has(domain)
    );
  };
  return {
    summaries: [...builtIn.summaries.filter(keep), ...custom.summaries],
    skills: new Map([
      ...[...builtIn.skills].filter(([, skill]) => keep(skill)),
      ...custom.skills,
    ]),
  };
}

function parseDisabledBuiltIns(value: string): "all" | Set<string> {
  if (value.trim().toLowerCase() === "true") return "all";
  return new Set(
    value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function getSkillRegistry(): SkillRegistry {
  if (cachedRegistry) return cachedRegistry;

  const builtIn = loadSkillsFromDirectory(resolveSkillsDir());
  if (!AGENT_SKILLS_DIR && !AGENT_SKILLS_DISABLE_BUILTINS) {
    cachedRegistry = builtIn;
    return cachedRegistry;
  }

  let custom: SkillRegistry = { summaries: [], skills: new Map() };
  if (AGENT_SKILLS_DIR) {
    if (skillsDirHasContent(AGENT_SKILLS_DIR)) {
      custom = loadSkillsFromDirectory(AGENT_SKILLS_DIR);
    } else {
      logger.warn(
        `AGENT_SKILLS_DIR is ${AGENT_SKILLS_DIR}, which has no <skill>/SKILL.md directories; no custom skills loaded.`,
      );
    }
  }
  cachedRegistry = mergeCustomSkills(
    builtIn,
    custom,
    parseDisabledBuiltIns(AGENT_SKILLS_DISABLE_BUILTINS),
  );
  return cachedRegistry;
}

/**
 * Skills are keyed `<domain>` or `<domain>/references/<workflow>`, but a domain
 * router lists its workflows as `references/<workflow>.md` — the path a
 * shell-capable agent would read — and sibling workflows refer to each other by
 * bare name. Accept those shapes when they point at exactly one skill, so the
 * caller doesn't have to reassemble the qualified key from the router's table.
 */
function resolveSkill(
  skills: Map<string, Skill>,
  name: string,
): Skill | undefined {
  const exact = skills.get(name);
  if (exact) return exact;

  const workflow = name.trim().split("/").pop()?.replace(/\.md$/, "");
  if (!workflow) return undefined;

  const matches = [...skills.keys()].filter(
    (key) => key === workflow || key.endsWith(`/references/${workflow}`),
  );
  return matches.length === 1 ? skills.get(matches[0]) : undefined;
}

// Exposed for unit tests — see test/agent/skills.test.ts
export const _loadSkillsFromDirectory = loadSkillsFromDirectory;
export const _resolveSkill = resolveSkill;
export const _mergeCustomSkills = mergeCustomSkills;
export const _parseDisabledBuiltIns = parseDisabledBuiltIns;

/** Domain routers only — the compact index inlined into the system prompt. */
export function listDomainSkills(): readonly SkillSummary[] {
  return getSkillRegistry().summaries.filter((s) => s.kind === "domain");
}

/** Domains and workflows — the composer's slash-command menu lists both. */
export function listSkillSummaries(): readonly SkillSummary[] {
  return getSkillRegistry().summaries;
}

export function readSkill(name: string): Skill | undefined {
  return resolveSkill(getSkillRegistry().skills, name);
}
