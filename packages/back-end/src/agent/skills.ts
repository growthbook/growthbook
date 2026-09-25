import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { OrgSkillSummary, SkillSummary } from "shared/ai-chat";
import type { OrganizationInterface } from "shared/types/organization";
import { logger } from "back-end/src/util/logger";
import { AGENT_SKILLS_DIR } from "back-end/src/util/secrets";

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
 * router's workflow table. Any other text file in a skill's folder loads by
 * path (`<domain>/<path>`) but is never listed.
 *
 * Self-hosted installs can add skills in the same layout from
 * `AGENT_SKILLS_DIR`; orgs turn skills off in settings.
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

// Names key the lookup and `/` separates a workflow or file path from its domain.
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

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
  if (!SKILL_NAME_RE.test(name)) {
    logger.warn(
      `Skill ${directoryName}/SKILL.md is named "${name}", which isn't lowercase letters, digits, hyphens and underscores; skipping it.`,
    );
    return null;
  }
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

/** Every other non-binary file in the folder; scripts load as text, since nothing here runs them. */
function readSkillFiles(
  skillsDir: string,
  directoryName: string,
  domainName: string,
): Skill[] {
  const domainDir = path.join(skillsDir, directoryName);
  const files: Skill[] = [];
  for (const file of fs
    .readdirSync(domainDir, { recursive: true, encoding: "utf8" })
    .sort()) {
    const relative = file.split(path.sep).join("/");
    if (relative === "SKILL.md" || /^references\/[^/]+\.md$/.test(relative)) {
      continue;
    }
    if (relative.split("/").some((part) => part.startsWith("."))) continue;
    const fullPath = path.join(domainDir, file);
    if (!fs.statSync(fullPath).isFile()) continue;

    const content = fs.readFileSync(fullPath);
    if (content.subarray(0, 8000).includes(0)) continue;
    files.push({
      name: `${domainName}/${relative}`,
      description: "",
      body: content.toString("utf8"),
      kind: "file",
      group: domainName,
    });
  }
  return files;
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
    if (domainReferences?.length === 0) {
      logger.warn(
        `Skill domain "${domain.name}" has no workflows. Run 'pnpm --filter back-end assemble-skills' with a growthbook/skills checkout; see packages/back-end/src/agent/README.md.`,
      );
    }
    for (const reference of domainReferences ?? []) {
      skills.set(reference.name, reference);
      summaries.push(toSummary(reference));
    }
    for (const file of readSkillFiles(dir, entry, domain.name)) {
      skills.set(file.name, file);
    }
  }

  const names = summaries.map((s) => s.name);
  const domainCount = summaries.filter((s) => s.kind === "domain").length;
  logger.info(
    `Loaded ${names.length} agent skill(s) from ${dir} (${domainCount} domain, ${names.length - domainCount} reference, ${skills.size - names.length} file): ${names.join(", ")}`,
  );
  return { summaries, skills };
}

/**
 * Layers a self-hosted install's own skills over the built-ins. A custom domain
 * replaces the built-in of the same name, workflows and files included.
 */
function mergeCustomSkills(
  builtIn: SkillRegistry,
  custom: SkillRegistry,
): SkillRegistry {
  const customDomains = new Set(
    custom.summaries.filter((s) => s.kind === "domain").map((s) => s.name),
  );
  for (const { name, kind } of builtIn.summaries) {
    if (kind === "domain" && customDomains.has(name)) {
      logger.info(`Custom agent skill "${name}" overrides the built-in one.`);
    }
  }

  const keep = ({ name, group }: SkillSummary) =>
    !customDomains.has(group ?? name);
  return {
    summaries: [
      ...builtIn.summaries.filter(keep),
      ...custom.summaries.map((s) => ({ ...s, custom: true })),
    ],
    skills: new Map([
      ...[...builtIn.skills].filter(([, skill]) => keep(skill)),
      ...[...custom.skills].map(([name, skill]): [string, Skill] => [
        name,
        { ...skill, custom: true },
      ]),
    ]),
  };
}

const CUSTOM_SKILLS_RECHECK_MS = 30_000;
let builtInRegistry: SkillRegistry | null = null;
let customSkillsSignature = "";
let customSkillsCheckedAt = 0;

/** Path, mtime and size of every file under `dir`, so any edit, add or delete changes it. */
function dirSignature(dir: string): string {
  try {
    return fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => !file.split(path.sep).some((p) => p.startsWith(".")))
      .sort()
      .map((file) => {
        const stat = fs.statSync(path.join(dir, file));
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

/** Rate-limited so reads stay cheap; stat is used over fs.watch, which misses ConfigMap swaps. */
function customSkillsChanged(): boolean {
  if (!AGENT_SKILLS_DIR) return false;
  const now = Date.now();
  if (now - customSkillsCheckedAt < CUSTOM_SKILLS_RECHECK_MS) return false;
  customSkillsCheckedAt = now;
  return dirSignature(AGENT_SKILLS_DIR) !== customSkillsSignature;
}

function getSkillRegistry(): SkillRegistry {
  if (cachedRegistry && !customSkillsChanged()) return cachedRegistry;

  builtInRegistry ??= loadSkillsFromDirectory(resolveSkillsDir());
  if (!AGENT_SKILLS_DIR) {
    cachedRegistry = builtInRegistry;
    return cachedRegistry;
  }

  customSkillsSignature = dirSignature(AGENT_SKILLS_DIR);
  customSkillsCheckedAt = Date.now();
  let custom: SkillRegistry = { summaries: [], skills: new Map() };
  if (skillsDirHasContent(AGENT_SKILLS_DIR)) {
    custom = loadSkillsFromDirectory(AGENT_SKILLS_DIR);
  } else {
    logger.warn(
      `AGENT_SKILLS_DIR is ${AGENT_SKILLS_DIR}, which has no <skill>/SKILL.md directories; no custom skills loaded.`,
    );
  }
  cachedRegistry = mergeCustomSkills(builtInRegistry, custom);
  return cachedRegistry;
}

/**
 * Skills are keyed `<domain>`, `<domain>/references/<workflow>` or
 * `<domain>/<file path>`, but a domain router lists its workflows as
 * `references/<workflow>.md` — the path a shell-capable agent would read — and
 * refers to its other files by relative path, while sibling workflows name each
 * other bare. Accept those shapes when they point at exactly one skill, so the
 * caller doesn't have to reassemble the qualified key.
 */
function resolveSkill(
  skills: Map<string, Skill>,
  name: string,
): Skill | undefined {
  const trimmed = name.trim().replace(/^\.\//, "");
  const exact = skills.get(trimmed);
  if (exact) return exact;

  const workflow = trimmed.split("/").pop()?.replace(/\.md$/, "");
  if (!workflow) return undefined;

  const matches = [...skills.keys()].filter(
    (key) =>
      key === workflow ||
      key.endsWith(`/references/${workflow}`) ||
      key.endsWith(`/${trimmed}`),
  );
  return matches.length === 1 ? skills.get(matches[0]) : undefined;
}

/** Turning off a domain in org settings turns off its workflows too. */
function enabledFor(org: OrganizationInterface) {
  const disabled = new Set(org.settings?.disabledAgentSkills ?? []);
  return ({ name, group }: SkillSummary) => !disabled.has(group ?? name);
}

// Exposed for unit tests — see test/agent/skills.test.ts
export const _loadSkillsFromDirectory = loadSkillsFromDirectory;
export const _resolveSkill = resolveSkill;
export const _mergeCustomSkills = mergeCustomSkills;
export const _enabledFor = enabledFor;
export const _dirSignature = dirSignature;

/** Domain routers only — the compact index inlined into the system prompt. */
export function listDomainSkills(
  org: OrganizationInterface,
): readonly SkillSummary[] {
  const enabled = enabledFor(org);
  return getSkillRegistry().summaries.filter(
    (s) => s.kind === "domain" && enabled(s),
  );
}

/** Domains and workflows, flagged for the org — for the slash-command menu and settings. */
export function listSkillSummaries(
  org: OrganizationInterface,
): OrgSkillSummary[] {
  const enabled = enabledFor(org);
  return getSkillRegistry().summaries.map((s) => ({
    ...s,
    enabled: enabled(s),
  }));
}

export function readSkill(
  org: OrganizationInterface,
  name: string,
): Skill | undefined {
  const enabled = enabledFor(org);
  const skills = new Map(
    [...getSkillRegistry().skills].filter(([, skill]) => enabled(skill)),
  );
  return resolveSkill(skills, name);
}
