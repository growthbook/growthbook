#!/usr/bin/env node
/**
 * Check growthbook/skills against the REST API in generated/spec.yaml.
 *
 * Reports skill references (`GET /api/v2/...`) to endpoints that are missing
 * or deprecated. With --base-spec, also lists skill files that reference an
 * operation whose spec changed, so API PRs can see which skills to update.
 *
 * Usage:
 *   node scripts/check-agent-skills-drift.mjs [--skills <dir>] [--spec <file>]
 *     [--base-spec <file>] [--strict]
 *
 * --skills defaults to $SKILLS_SRC, then skills-src/. --strict exits 1 when a
 * skill uses an operation the change removes, or (without --base-spec) when a
 * skill references any missing endpoint.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const METHODS = ["get", "post", "put", "patch", "delete"];
const PATH_RE = /^ {2}(\/\S+):\s*$/;
const METHOD_RE = new RegExp(`^ {4}(${METHODS.join("|")}):\\s*$`);
const REF_RE =
  /\b(GET|POST|PUT|PATCH|DELETE)\s+['"`]?(\/api\/v\d+\/[^\s'"`)?]+)/g;

export function parseSpecOperations(specText) {
  const operations = new Map();
  let inPaths = false;
  let currentPath = null;
  let current = null;
  const flush = () => {
    if (current) {
      const body = current.lines.join("\n");
      operations.set(`${current.method} ${current.path}`, {
        method: current.method,
        path: current.path,
        body,
        deprecated:
          /^ {6}deprecated: true$/m.test(body) ||
          body.includes("**Deprecated.**"),
      });
    }
    current = null;
  };
  for (const line of specText.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^\S/.test(line)) {
      flush();
      break;
    }
    const pathMatch = PATH_RE.exec(line);
    if (pathMatch) {
      flush();
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = METHOD_RE.exec(line);
    if (methodMatch && currentPath) {
      flush();
      current = {
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        lines: [],
      };
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      flush();
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return operations;
}

export function extractSkillReferences(text) {
  const refs = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(REF_RE)) {
      refs.push({
        method: match[1],
        path: match[2].replace(/^\/api/, "").replace(/[.,;:]+$/, ""),
        line: index + 1,
      });
    }
  });
  return refs;
}

const isSpecParam = (segment) => /^\{[^}]+\}$/.test(segment);

function scoreMatch(refPath, specPath) {
  const refSegments = refPath.split("/");
  const specSegments = specPath.split("/");
  if (refSegments.length !== specSegments.length) return -1;
  let score = 0;
  for (let i = 0; i < specSegments.length; i++) {
    if (specSegments[i] === refSegments[i]) score++;
    else if (!isSpecParam(specSegments[i])) return -1;
  }
  return score;
}

export function resolveReference(ref, operations) {
  const specPaths = new Set([...operations.values()].map((op) => op.path));
  let bestPath = null;
  let bestScore = -1;
  for (const specPath of specPaths) {
    const score = scoreMatch(ref.path, specPath);
    if (score > bestScore) {
      bestScore = score;
      bestPath = specPath;
    }
  }
  if (!bestPath) return { status: "missing-path" };
  const operation = operations.get(`${ref.method} ${bestPath}`);
  if (!operation) {
    const methods = METHODS.map((m) => m.toUpperCase()).filter((m) =>
      operations.has(`${m} ${bestPath}`),
    );
    return { status: "missing-method", path: bestPath, methods };
  }
  return {
    status: operation.deprecated ? "deprecated" : "ok",
    key: `${operation.method} ${operation.path}`,
  };
}

export function changedOperations(baseOperations, headOperations) {
  const changed = new Map();
  for (const [key, op] of headOperations) {
    const before = baseOperations.get(key);
    if (!before) changed.set(key, "added");
    else if (before.body !== op.body) changed.set(key, "changed");
  }
  for (const key of baseOperations.keys()) {
    if (!headOperations.has(key)) changed.set(key, "removed");
  }
  return changed;
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

export function analyze({ skillFiles, operations, baseOperations = null }) {
  const missing = [];
  const deprecated = [];
  const impacted = new Map();
  const changed = baseOperations
    ? changedOperations(baseOperations, operations)
    : new Map();
  const removedKeys = [...changed].filter(([, kind]) => kind === "removed");

  for (const { file, text } of skillFiles) {
    for (const ref of extractSkillReferences(text)) {
      const location = `${file}:${ref.line}`;
      const label = `${ref.method} /api${ref.path}`;
      const result = resolveReference(ref, operations);
      if (result.status === "missing-path") {
        missing.push({ location, label, detail: "no such path" });
      } else if (result.status === "missing-method") {
        missing.push({
          location,
          label,
          detail: `path only supports ${result.methods.join(", ")}`,
        });
      } else if (result.status === "deprecated") {
        deprecated.push({ location, label });
      }

      const key =
        result.key ??
        (baseOperations
          ? removedKeys.find(
              ([removed]) =>
                removed.startsWith(`${ref.method} `) &&
                scoreMatch(ref.path, removed.slice(ref.method.length + 1)) >= 0,
            )?.[0]
          : null);
      if (key && changed.has(key)) {
        const entry = impacted.get(key) ?? {
          kind: changed.get(key),
          files: new Set(),
        };
        entry.files.add(file);
        impacted.set(key, entry);
      }
    }
  }
  return { missing, deprecated, impacted };
}

export function formatReport(
  { missing, deprecated, impacted },
  { skillsLabel },
) {
  const out = [`## Agent skills drift (${skillsLabel})`, ""];
  if (impacted.size > 0) {
    out.push(
      "### Skills affected by this change",
      "",
      "These operations changed in `spec.yaml` and are used by a skill. Update the skill in growthbook/skills, then bump `packages/back-end/agent-skills.lock.json`.",
      "",
    );
    for (const [key, { kind, files }] of [...impacted].sort()) {
      out.push(
        `- \`${key}\` (${kind}): ${[...files]
          .sort()
          .map((f) => `\`${f}\``)
          .join(", ")}`,
      );
    }
    out.push("");
  }
  if (missing.length > 0) {
    out.push("### References to endpoints that do not exist", "");
    for (const { location, label, detail } of missing) {
      out.push(`- \`${location}\` — \`${label}\` (${detail})`);
    }
    out.push("");
  }
  if (deprecated.length > 0) {
    out.push("### References to deprecated endpoints", "");
    for (const { location, label } of deprecated) {
      out.push(`- \`${location}\` — \`${label}\``);
    }
    out.push("");
  }
  if (impacted.size === 0 && missing.length === 0 && deprecated.length === 0) {
    out.push("No drift found.", "");
  }
  return out.join("\n");
}

export function hasBlockingDrift({ missing, impacted }, hasBase) {
  if (!hasBase) return missing.length > 0;
  return [...impacted.values()].some(({ kind }) => kind === "removed");
}

function parseArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--strict") args.strict = true;
    else if (["--skills", "--spec", "--base-spec"].includes(flag)) {
      args[flag.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillsRoot = path.resolve(
    args.skills ?? process.env.SKILLS_SRC ?? path.join(REPO_ROOT, "skills-src"),
  );
  const skillsDir = path.join(skillsRoot, "skills");
  if (!existsSync(skillsDir)) {
    process.stderr.write(
      `No skills/ directory in ${skillsRoot}. Pass --skills <growthbook/skills checkout> or set SKILLS_SRC.\n`,
    );
    process.exit(2);
  }
  const specPath = path.resolve(
    args.spec ?? path.join(REPO_ROOT, "packages/back-end/generated/spec.yaml"),
  );
  const operations = parseSpecOperations(readFileSync(specPath, "utf8"));
  const baseOperations = args["base-spec"]
    ? parseSpecOperations(readFileSync(path.resolve(args["base-spec"]), "utf8"))
    : null;
  const skillFiles = markdownFiles(skillsDir).map((file) => ({
    file: path.relative(skillsRoot, file),
    text: readFileSync(file, "utf8"),
  }));

  const result = analyze({ skillFiles, operations, baseOperations });
  process.stdout.write(
    formatReport(result, { skillsLabel: path.basename(skillsRoot) }) + "\n",
  );
  if (args.strict && hasBlockingDrift(result, baseOperations !== null)) {
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
