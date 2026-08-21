import fs from "fs";
import path from "path";
import { logger } from "back-end/src/util/logger";

export interface SkillMetadata {
  name: string;
  description: string;
}

export interface Skill extends SkillMetadata {
  body: string;
}

interface SkillRegistry {
  domains: SkillMetadata[];
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
  const domain = {
    name: frontmatter.name || directoryName,
    description: frontmatter.description || "",
    body: body.trim(),
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

    const name = `${directoryName}/references/${path.basename(file, ".md")}`;
    const { data: frontmatter, body } = readMarkdownFile(referencePath);
    references.push({
      name,
      description: frontmatter.description || "",
      body: body.trim(),
    });
  }
  return references;
}

let cachedRegistry: SkillRegistry | null = null;

function loadSkillsFromDisk(): SkillRegistry {
  const dir = resolveSkillsDir();
  if (!dir) {
    logger.warn(
      `No skills directory found near ${__dirname}; the generic agent will run without skill instructions.`,
    );
    return { domains: [], skills: new Map() };
  }

  const domains: SkillMetadata[] = [];
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
    domains.push({ name: domain.name, description: domain.description });
    skills.set(domain.name, domain);

    const domainReferences = readReferenceSkills(dir, entry);
    if (domainReferences === null) continue;
    if (domainReferences.length === 0) {
      logger.warn(
        `Skill domain "${domain.name}" has no workflows. Run 'pnpm --filter back-end assemble:skills' with a growthbook/skills checkout; see packages/back-end/src/agent/AGENT_SKILLS.md.`,
      );
    }
    for (const reference of domainReferences) {
      skills.set(reference.name, reference);
    }
  }

  const names = [...skills.keys()];
  logger.info(
    `Loaded ${names.length} agent skill(s) from ${dir} (${domains.length} domain, ${names.length - domains.length} reference): ${names.join(", ")}`,
  );
  return { domains, skills };
}

function getSkillRegistry(): SkillRegistry {
  if (!cachedRegistry) {
    cachedRegistry = loadSkillsFromDisk();
  }
  return cachedRegistry;
}

export function listDomainSkills(): readonly SkillMetadata[] {
  return getSkillRegistry().domains;
}

export function readSkill(name: string): Skill | undefined {
  return getSkillRegistry().skills.get(name);
}
