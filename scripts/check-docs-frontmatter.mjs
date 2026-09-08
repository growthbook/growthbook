#!/usr/bin/env node
/**
 * Fail if MDX/MD YAML frontmatter uses an unquoted scalar that contains
 * `: ` (colon + space) or ` #`. YAML treats those as a nested mapping or
 * a comment, so titles like `AI Mode: Generate…` must be quoted.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const LINE_RE = /^(\s*)([\w-]+):\s+(.*)$/;

export function findUnquotedYamlIssues(lines) {
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const value = match[3].trim();
    if (!value || isQuotedOrStructured(value)) continue;
    if (!/: | #/.test(value)) continue;
    issues.push({
      index: i,
      key: match[2],
      line: line.trimEnd(),
    });
  }
  return issues;
}

function isQuotedOrStructured(value) {
  return (
    value.startsWith('"') ||
    value.startsWith("'") ||
    value.startsWith("|") ||
    value.startsWith(">") ||
    value.startsWith("{") ||
    value.startsWith("[")
  );
}

function extractFrontmatter(source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  return { lines: lines.slice(1, end), startLine: 2 };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

function selfTest() {
  const cases = [
    { lines: ["title: AI Mode: Generate"], want: 1 },
    { lines: ['title: "AI Mode: Generate"'], want: 0 },
    { lines: ["title: 'AI Mode: Generate'"], want: 0 },
    { lines: ["title: Feature Flags"], want: 0 },
    { lines: ["title: Config.yml"], want: 0 },
    { lines: ["description: See https://docs.growthbook.io"], want: 0 },
    { lines: ["description: Foo # truncated"], want: 1 },
    { lines: ['description: "Foo # kept"'], want: 0 },
  ];
  for (const testCase of cases) {
    const got = findUnquotedYamlIssues(testCase.lines).length;
    if (got !== testCase.want) {
      throw new Error(
        `self-test failed for ${JSON.stringify(testCase.lines)}: expected ${testCase.want}, got ${got}`,
      );
    }
  }
}

async function main() {
  selfTest();

  const errors = [];
  for await (const file of walk(DOCS_ROOT)) {
    const source = await readFile(file, "utf8");
    const frontmatter = extractFrontmatter(source);
    if (!frontmatter) continue;
    for (const issue of findUnquotedYamlIssues(frontmatter.lines)) {
      const rel = path.relative(REPO_ROOT, file);
      const lineNo = frontmatter.startLine + issue.index;
      errors.push(
        `${rel}:${lineNo}: unquoted YAML value contains ": " or " #". Quote it.\n  ${issue.line}\n  ${issue.key}: "${issue.line.slice(issue.line.indexOf(":") + 1).trim()}"`,
      );
    }
  }

  if (errors.length > 0) {
    process.stderr.write(
      `Found ${errors.length} unquoted YAML frontmatter value${errors.length === 1 ? "" : "s"}:\n\n`,
    );
    for (const error of errors) {
      process.stderr.write(`${error}\n\n`);
    }
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  await main();
}
