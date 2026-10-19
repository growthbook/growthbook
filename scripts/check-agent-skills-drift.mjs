#!/usr/bin/env node
/**
 * Check growthbook/skills against the REST API in generated/spec.yaml.
 *
 * Reports skill references to endpoints that are missing or deprecated:
 * `GET /api/v2/...` style calls, and quoted `/api/vN/...` paths without a
 * method. References resolve the way the API router does: the first route
 * registered for the method whose template matches, in spec order.
 *
 * With --base-spec, also reports skill references whose operation was
 * removed, newly deprecated, or changed (including referenced components,
 * but not doc text or code samples). With --baseline-skills, reports broken
 * references beyond what the baseline checkout already had, counted per
 * method and path so moving or respelling one is not new.
 *
 * Usage:
 *   node scripts/check-agent-skills-drift.mjs [--skills <dir>] [--spec <file>]
 *     [--base-spec <file>] [--baseline-skills <dir>] [--strict] [--json]
 *
 * --skills defaults to $SKILLS_SRC, then skills-src/. --strict exits 1 when a
 * skill uses an operation the change removes, when --baseline-skills finds
 * new broken references, or (with neither) on any missing endpoint.
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
const COMPONENT_RE = /^ {4}(\S.*?):\s*$/;
const COMPONENT_REF_RE = /#\/components\/([A-Za-z]+)\/([^'"\n]+)/g;
const REF_RE =
  /\b(GET|POST|PUT|PATCH|DELETE)\s+['"`]?((?:\/api)?\/v\d+\/[^\s'"`)?]+)/g;
const PATH_ONLY_RE = /[`'"](\/api\/v\d+\/[^\s'"`)?]+)/g;
const NEGATION_RE = /\b(not|never|instead of|rather than|avoid)\s+[`'"]?$/i;
const DOC_KEY_RE =
  /^(\s*)(- )?(description|summary|example|examples|title):\s*\S/;
const DOC_BLOCK_RE = /^(\s*)(- )?(x-codeSamples|examples):\s*$/;
const PLACEHOLDER_RE = /^(<[^>]+>|:\w+|\{[^}]+\}|\$\{?\w+\}?)$/;

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
        deprecated: /^ {6}deprecated: true$/m.test(body),
      });
    } else if (current?.kind === "component") {
      components.set(current.key, current.lines.join("\n"));
    }
    current = null;
  };
  for (const line of specText.split(/\r?\n/)) {
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

// Doc text (descriptions, titles, examples, code samples) never changes what
// a request must look like, so signatures leave it out. A property that
// happens to be named `description` or `title` has no inline value and is
// kept.
export function stripDocText(body) {
  const out = [];
  let skipIndent = null;
  // When a doc key opens a list item, its dash moves to the next sibling key
  // so `- title: X` + `$ref: Y` matches a plain `- $ref: Y`.
  let dashIndent = null;
  const flushDash = () => {
    if (dashIndent !== null) out.push(`${" ".repeat(dashIndent)}-`);
    dashIndent = null;
  };
  for (const line of body.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (skipIndent !== null) {
      if (line.trim() === "" || indent > skipIndent) continue;
      skipIndent = null;
    }
    const doc = DOC_KEY_RE.exec(line) ?? DOC_BLOCK_RE.exec(line);
    if (doc) {
      const keyIndent = doc[1].length + (doc[2] ? 2 : 0);
      if (doc[2]) {
        flushDash();
        dashIndent = doc[1].length;
      }
      skipIndent = keyIndent;
      continue;
    }
    if (dashIndent !== null && indent === dashIndent + 2) {
      out.push(`${" ".repeat(dashIndent)}- ${line.trimStart()}`);
      dashIndent = null;
      continue;
    }
    flushDash();
    out.push(line);
  }
  flushDash();
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

const cleanPath = (raw) => raw.replace(/^\/api/, "").replace(/[.,;:]+$/, "");

export function extractSkillReferences(text) {
  const refs = [];
  text.split("\n").forEach((line, index) => {
    const spans = [];
    for (const match of line.matchAll(REF_RE)) {
      spans.push([match.index, match.index + match[0].length]);
      if (NEGATION_RE.test(line.slice(0, match.index))) continue;
      refs.push({
        method: match[1],
        path: cleanPath(match[2]),
        line: index + 1,
      });
    }
    for (const match of line.matchAll(PATH_ONLY_RE)) {
      const inSpan = spans.some(
        ([start, end]) => match.index >= start && match.index < end,
      );
      if (inSpan || NEGATION_RE.test(line.slice(0, match.index))) continue;
      // Wildcards and elisions in prose are patterns, not paths.
      if (/\*|\.\.\./.test(match[1])) continue;
      refs.push({ method: "ANY", path: cleanPath(match[1]), line: index + 1 });
    }
  });
  return refs;
}

function templateMatches(refPath, specPath) {
  const refSegments = refPath.split("/");
  const specSegments = specPath.split("/");
  if (refSegments.length !== specSegments.length) return false;
  return specSegments.every(
    (segment, i) => /^\{[^}]+\}$/.test(segment) || segment === refSegments[i],
  );
}

// Route identity ignores parameter names: `{id}` and `{experimentId}` in the
// same place are the same route.
export const routeKey = (method, specPath) =>
  `${method} ${specPath.replace(/\{[^}]+\}/g, "{}")}`;

export function resolveReference(ref, operations) {
  let anyPath = null;
  for (const op of operations.values()) {
    if (!templateMatches(ref.path, op.path)) continue;
    if (ref.method === "ANY" || op.method === ref.method) {
      return {
        status: op.deprecated ? "deprecated" : "ok",
        key: `${op.method} ${op.path}`,
        route: routeKey(op.method, op.path),
      };
    }
    anyPath ??= op.path;
  }
  if (!anyPath) return { status: "missing-path" };
  const methods = [...operations.values()]
    .filter((op) => op.path === anyPath)
    .map((op) => op.method);
  return { status: "missing-method", path: anyPath, methods };
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

// Findings are compared by method and normalized path, not file, so moving a
// reference or respelling its placeholder is not a new finding.
export const findingKey = ({ method, path: refPath }) =>
  `${method} ${refPath
    .split("/")
    .map((s) => (PLACEHOLDER_RE.test(s) ? "{}" : s))
    .join("/")}`;

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

// Findings the baseline already had are matched in the same file first, then
// anywhere, so what is left over points at the reference that was added.
export function newFindings(current, baseline) {
  const exact = new Map();
  const normalized = new Map();
  const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by);
  for (const finding of baseline) {
    bump(exact, `${finding.file}|${findingKey(finding)}`, 1);
    bump(normalized, findingKey(finding), 1);
  }
  const leftover = [];
  for (const finding of current) {
    const key = `${finding.file}|${findingKey(finding)}`;
    if ((exact.get(key) ?? 0) > 0) {
      bump(exact, key, -1);
      bump(normalized, findingKey(finding), -1);
    } else {
      leftover.push(finding);
    }
  }
  return leftover.filter((finding) => {
    const key = findingKey(finding);
    if ((normalized.get(key) ?? 0) > 0) {
      bump(normalized, key, -1);
      return false;
    }
    return true;
  });
}

const KIND_RANK = { removed: 3, deprecated: 2, changed: 1, added: 0 };

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
    if (KIND_RANK[kind] > KIND_RANK[entry.kind]) entry.kind = kind;
    entry.files.add(file);
    impacted.set(key, entry);
  };

  if (baseSpec) {
    for (const { file, text } of skillFiles) {
      for (const ref of extractSkillReferences(text)) {
        if (ref.method === "ANY") continue;
        const before = resolveReference(ref, baseSpec.operations);
        const after = resolveReference(ref, spec.operations);
        if (!before.key) {
          if (after.key) mark(after.key, "added", file);
          continue;
        }
        if (after.route !== before.route) {
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
    introduced = newFindings(
      [...missing, ...deprecated],
      [...baseline.missing, ...baseline.deprecated],
    );
  }
  // New operations no skill calls yet: candidates for a skill update or a
  // new workflow. Informational only.
  const uncovered = [];
  if (baseSpec) {
    const used = new Set();
    for (const { text } of skillFiles) {
      for (const ref of extractSkillReferences(text)) {
        const resolved = resolveReference(ref, spec.operations);
        if (resolved.route) used.add(resolved.route);
      }
    }
    const before = new Set(
      [...baseSpec.operations.values()].map((op) =>
        routeKey(op.method, op.path),
      ),
    );
    for (const op of spec.operations.values()) {
      const route = routeKey(op.method, op.path);
      if (!before.has(route) && !used.has(route) && !op.deprecated) {
        uncovered.push(`${op.method} ${op.path}`);
      }
    }
  }
  return { missing, deprecated, impacted, introduced, uncovered };
}

export function hasBlockingDrift(result, { hasBase, hasBaseline }) {
  if (hasBaseline && result.introduced.length > 0) return true;
  if (hasBase) {
    return [...result.impacted.values()].some(({ kind }) => kind === "removed");
  }
  return !hasBaseline && result.missing.length > 0;
}

const label = (finding) =>
  finding.method === "ANY"
    ? `/api${finding.path}`
    : `${finding.method} /api${finding.path}`;
const location = (finding) => `${finding.file}:${finding.line}`;

export function formatReport(
  { missing, deprecated, impacted, introduced, uncovered = [] },
  { skillsLabel },
) {
  const out = [`## Agent skills drift (${skillsLabel})`, ""];
  if (impacted.size > 0) {
    out.push(
      "### Skills affected by this change",
      "",
      "These operations changed in `spec.yaml` and are used by a skill. Removals fail this check; update the skill in growthbook/skills, or see `.agents/guides/agent-skills.md`.",
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
  if (uncovered.length > 0) {
    out.push(
      "### New endpoints no skill uses",
      "",
      "Consider whether a skill should cover these; see `.agents/guides/agent-skills.md`.",
      "",
      ...uncovered.map((key) => `- \`${key}\``),
      "",
    );
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
    uncovered.length === 0 &&
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
    uncovered: result.uncovered ?? [],
    impacted: [...result.impacted].sort().map(([key, { kind, files }]) => ({
      key,
      kind,
      files: [...files].sort(),
    })),
  };
}

function parseArgs(argv) {
  const args = { strict: false, json: false };
  const valued = ["--skills", "--spec", "--base-spec", "--baseline-skills"];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--strict") args.strict = true;
    else if (flag === "--json") args.json = true;
    else if (valued.includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      args[flag.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readSkills(root) {
  const skillsDir = path.join(root, "skills");
  if (!existsSync(skillsDir)) {
    fail(
      `No skills/ directory in ${root}. Pass --skills <growthbook/skills checkout> or set SKILLS_SRC.`,
    );
  }
  return markdownFiles(skillsDir).map((file) => ({
    file: path.relative(root, file),
    text: readFileSync(file, "utf8"),
  }));
}

function readSpec(file, label) {
  const spec = parseSpec(readFileSync(path.resolve(file), "utf8"));
  if (spec.operations.size === 0) {
    fail(`The ${label} spec (${file}) has no operations under paths:.`);
  }
  return spec;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillsRoot = path.resolve(
    args.skills ?? process.env.SKILLS_SRC ?? path.join(REPO_ROOT, "skills-src"),
  );
  const spec = readSpec(
    args.spec ?? path.join(REPO_ROOT, "packages/back-end/generated/spec.yaml"),
    "head",
  );
  const baseSpec = args["base-spec"]
    ? readSpec(args["base-spec"], "base")
    : null;
  const result = analyze({
    skillFiles: readSkills(skillsRoot),
    spec,
    baseSpec,
    baselineSkillFiles: args["baseline-skills"]
      ? readSkills(path.resolve(args["baseline-skills"]))
      : null,
  });
  const text = args.json
    ? JSON.stringify(toJson(result), null, 2) + "\n"
    : formatReport(result, { skillsLabel: path.basename(skillsRoot) }) + "\n";
  const blocking =
    args.strict &&
    hasBlockingDrift(result, {
      hasBase: baseSpec !== null,
      hasBaseline: Boolean(args["baseline-skills"]),
    });
  // Set the exit code instead of calling exit() so piped output is flushed.
  process.stdout.write(text, () => {
    if (blocking) process.exitCode = 1;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
