import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const BACK_END = path.join(REPO_ROOT, "packages", "back-end");

export interface SourceVersion {
  path: string;
  sha: string | null;
  dirty: boolean;
}

function versionOf(dir: string): SourceVersion {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  try {
    return {
      path: dir,
      sha: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain").length > 0,
    };
  } catch {
    return { path: dir, sha: null, dirty: false };
  }
}

// Mirrors scripts/assemble-agent-skills.mjs, which the eval command runs
// first: $SKILLS_SRC, then agent-skills.local.json, then skills-src/.
function skillsSource(skillsSrc: string | null): string | null {
  if (skillsSrc) return path.resolve(BACK_END, skillsSrc);
  const local = path.join(BACK_END, "agent-skills.local.json");
  if (existsSync(local)) {
    const { path: p } = JSON.parse(readFileSync(local, "utf8")) as {
      path?: string;
    };
    return p ? path.resolve(REPO_ROOT, p) : null;
  }
  const bundled = path.join(REPO_ROOT, "skills-src");
  return existsSync(path.join(bundled, "skills")) ? bundled : null;
}

export interface RunMetadata {
  growthbook: SourceVersion;
  skills: SourceVersion | null;
}

export function runMetadata(skillsSrc: string | null): RunMetadata {
  const skills = skillsSource(skillsSrc);
  return {
    growthbook: versionOf(REPO_ROOT),
    skills: skills ? versionOf(skills) : null,
  };
}

export const RESULTS_ROOT = path.join(BACK_END, "test", "evals", ".results");
