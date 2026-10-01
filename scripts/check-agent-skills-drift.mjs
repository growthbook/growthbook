#!/usr/bin/env node
/**
 * Check growthbook/skills against the REST API in generated/spec.yaml.
 *
 * Reports skill references (`GET /api/v2/...`) to endpoints that are missing
 * or deprecated. With --base-spec, also reports skill references whose
 * operation was removed, re-routed, newly deprecated, or changed (including
 * shared component schemas). With --baseline-skills, reports findings that
 * the baseline skills checkout did not have.
 *
 * Usage:
 *   node scripts/check-agent-skills-drift.mjs [--skills <dir>] [--spec <file>]
 *     [--base-spec <file>] [--baseline-skills <dir>] [--strict] [--json]
 *
 * --skills defaults to $SKILLS_SRC, then skills-src/. --strict exits 1 on
 * blocking drift: a skill uses an operation the change removes or deprecates,
 * a finding is new compared with --baseline-skills, or (with neither base)
 * any missing endpoint.
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
const COMPONENT_TYPE_RE = /^ {2}([A-Za-z]+):\s*$/;
const COMPONENT_RE = /^ {4}([A-Za-z0-9_.-]+):\s*$/;
const COMPONENT_REF_RE = /#\/components\/([A-Za-z]+)\/([A-Za-z0-9_.-]+)/g;
const REF_RE =
  /\b(GET|POST|PUT|PATCH|DELETE)\s+['"`]?((?:\/api)?\/v\d+\/[^\s'"`)?]+)/g;
const DOC_KEY_RE = /^(\s*)(description|summary|example|examples):\s*\S/;

function isDeprecated(body) {
  return (
    /^ {6}deprecated: true$/m.test(body) || body.includes("**Deprecated.**")
  );
}

export function parseSpec(specText) {
  const operations = new Map();
  const components = new Map();
  let section = null;
  let currentPath = null;
  let componentType = null;
  let current = null;
  const flush = () => {
    if (current?.kind === "operation") {
      const body = current.lines.join("\n");
      operations.set(`${current.method} ${current.path}`, {
        method: current.method,
        path: current.path,
        body,
        deprecated: isDeprecated(body),
      });
    } else if (current?.kind === "component") {
      components.set(current.key, current.lines.join("\n"));
    }
    current = null;
  };
  for (const line of specText.split("\n")) {
    if (/^\S/.test(line)) {
      flush();
      section = /^paths:\s*$/.test(line)
        ? "paths"
        : /^components:\s*$/.test(line)
          ? "components"
          : null;
      continue;
    }
    if (section === "paths") {
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
          kind: "operation",
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
    } else if (section === "components") {
      const typeMatch = COMPONENT_TYPE_RE.exec(line);
      if (typeMatch) {
        flush();
        componentType = typeMatch[1];
        continue;
      }
      const componentMatch = COMPONENT_RE.exec(line);
      if (componentMatch && componentType) {
        flush();
        current = {
          kind: "component",
          key: `${componentType}/${componentMatch[1]}`,
          lines: [],
        };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  flush();
  return { operations, components };
}

// Doc text (description, summary, examples) changes often and never changes
// what a request must look like, so signatures leave it out. A property that
// happens to be named `description` has no inline value and is kept.
export function stripDocText(body) {
  const out = [];
  let skipIndent = null;
  for (const line of body.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (skipIndent !== null) {
      if (line.trim() === "" || indent > skipIndent) continue;
      skipIndent = null;
    }
    const doc = DOC_KEY_RE.exec(line);
    if (doc) {
      skipIndent = doc[1].length;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function operationSignature(operation, components) {
  const seen = new Set();
  const queue = [operation.body];
  while (queue.length) {
    for (const [, type, name] of queue.pop().matchAll(COMPONENT_REF_RE)) {
      const key = `${type}/${name}`;
      if (seen.has(key) || !components.has(key)) continue;
      seen.add(key);
      queue.push(components.get(key));
    }
  }
  return [
    stripDocText(operation.body),
    ...[...seen]
      .sort()
      .map((key) => `${key}\n${stripDocText(components.get(key))}`),
  ].join("\n---\n");
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

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

export const findingKey = ({ file, method, path: refPath }) =>
  `${file}|${method}|${refPath}`;

function findings(skillFiles, operations) {
  const missing = [];
  const deprecated = [];
  for (const { file, text } of skillFiles) {
    for (const ref of extractSkillReferences(text)) {
      const entry = {
        file,
        line: ref.line,
        method: ref.method,
        path: ref.path,
      };
      const result = resolveReference(ref, operations);
      if (result.status === "missing-path") {
        missing.push({ ...entry, detail: "no such path" });
      } else if (result.status === "missing-method") {
        missing.push({
          ...entry,
          detail: `path only supports ${result.methods.join(", ")}`,
        });
      } else if (result.status === "deprecated") {
        deprecated.push(entry);
      }
    }
  }
  return { missing, deprecated };
}

export function analyze({
  skillFiles,
  spec,
  baseSpec = null,
  baselineSkillFiles = null,
}) {
  const { missing, deprecated } = findings(skillFiles, spec.operations);
  const impacted = new Map();
  const mark = (key, kind, file) => {
    const entry = impacted.get(key) ?? { kind, files: new Set() };
    entry.files.add(file);
    impacted.set(key, entry);
  };

  if (baseSpec) {
    for (const { file, text } of skillFiles) {
      for (const ref of extractSkillReferences(text)) {
        const before = resolveReference(ref, baseSpec.operations);
        const after = resolveReference(ref, spec.operations);
        if (!before.key) {
          if (after.key) mark(after.key, "added", file);
          continue;
        }
        if (after.key !== before.key) {
          mark(before.key, "removed", file);
          continue;
        }
        const baseOp = baseSpec.operations.get(before.key);
        const headOp = spec.operations.get(after.key);
        if (headOp.deprecated && !baseOp.deprecated) {
          mark(after.key, "deprecated", file);
        } else if (
          operationSignature(baseOp, baseSpec.components) !==
          operationSignature(headOp, spec.components)
        ) {
          mark(after.key, "changed", file);
        }
      }
    }
  }

  let introduced = [];
  if (baselineSkillFiles) {
    const baseline = findings(
      baselineSkillFiles,
      (baseSpec ?? spec).operations,
    );
    const known = new Set(
      [...baseline.missing, ...baseline.deprecated].map(findingKey),
    );
    introduced = [...missing, ...deprecated].filter(
      (finding) => !known.has(findingKey(finding)),
    );
  }
  return { missing, deprecated, impacted, introduced };
}

const BLOCKING_KINDS = new Set(["removed", "deprecated"]);

export function hasBlockingDrift(result, { hasBase, hasBaseline }) {
  if (hasBaseline && result.introduced.length > 0) return true;
  if (hasBase) {
    return [...result.impacted.values()].some(({ kind }) =>
      BLOCKING_KINDS.has(kind),
    );
  }
  return !hasBaseline && result.missing.length > 0;
}

const label = (finding) => `${finding.method} /api${finding.path}`;
const location = (finding) => `${finding.file}:${finding.line}`;

export function formatReport(
  { missing, deprecated, impacted, introduced },
  { skillsLabel },
) {
  const out = [`## Agent skills drift (${skillsLabel})`, ""];
  if (impacted.size > 0) {
    out.push(
      "### Skills affected by this change",
      "",
      "These operations changed in `spec.yaml` and are used by a skill. Update the skill in growthbook/skills; the lock bump follows automatically.",
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
  if (introduced.length > 0) {
    out.push("### New findings compared with the baseline skills", "");
    for (const finding of introduced) {
      out.push(`- \`${location(finding)}\` — \`${label(finding)}\``);
    }
    out.push("");
  }
  if (missing.length > 0) {
    out.push("### References to endpoints that do not exist", "");
    for (const finding of missing) {
      out.push(
        `- \`${location(finding)}\` — \`${label(finding)}\` (${finding.detail})`,
      );
    }
    out.push("");
  }
  if (deprecated.length > 0) {
    out.push("### References to deprecated endpoints", "");
    for (const finding of deprecated) {
      out.push(`- \`${location(finding)}\` — \`${label(finding)}\``);
    }
    out.push("");
  }
  if (
    impacted.size === 0 &&
    introduced.length === 0 &&
    missing.length === 0 &&
    deprecated.length === 0
  ) {
    out.push("No drift found.", "");
  }
  return out.join("\n");
}

export function toJson(result) {
  return {
    missing: result.missing,
    deprecated: result.deprecated,
    introduced: result.introduced,
    impacted: [...result.impacted].sort().map(([key, { kind, files }]) => ({
      key,
      kind,
      files: [...files].sort(),
    })),
  };
}

function parseArgs(argv) {
  const args = { strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--strict") args.strict = true;
    else if (flag === "--json") args.json = true;
    else if (
      ["--skills", "--spec", "--base-spec", "--baseline-skills"].includes(flag)
    ) {
      args[flag.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function readSkills(root) {
  const skillsDir = path.join(root, "skills");
  if (!existsSync(skillsDir)) {
    process.stderr.write(
      `No skills/ directory in ${root}. Pass --skills <growthbook/skills checkout> or set SKILLS_SRC.\n`,
    );
    process.exit(2);
  }
  return markdownFiles(skillsDir).map((file) => ({
    file: path.relative(root, file),
    text: readFileSync(file, "utf8"),
  }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillsRoot = path.resolve(
    args.skills ?? process.env.SKILLS_SRC ?? path.join(REPO_ROOT, "skills-src"),
  );
  const spec = parseSpec(
    readFileSync(
      path.resolve(
        args.spec ??
          path.join(REPO_ROOT, "packages/back-end/generated/spec.yaml"),
      ),
      "utf8",
    ),
  );
  if (spec.operations.size === 0) {
    process.stderr.write("The spec has no operations under paths:.\n");
    process.exit(2);
  }
  const baseSpec = args["base-spec"]
    ? parseSpec(readFileSync(path.resolve(args["base-spec"]), "utf8"))
    : null;
  const result = analyze({
    skillFiles: readSkills(skillsRoot),
    spec,
    baseSpec,
    baselineSkillFiles: args["baseline-skills"]
      ? readSkills(path.resolve(args["baseline-skills"]))
      : null,
  });
  process.stdout.write(
    args.json
      ? JSON.stringify(toJson(result), null, 2) + "\n"
      : formatReport(result, { skillsLabel: path.basename(skillsRoot) }) + "\n",
  );
  if (
    args.strict &&
    hasBlockingDrift(result, {
      hasBase: baseSpec !== null,
      hasBaseline: Boolean(args["baseline-skills"]),
    })
  ) {
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
