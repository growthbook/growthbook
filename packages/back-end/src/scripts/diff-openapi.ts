/**
 * CLI to diff two OpenAPI specs and list meaningful differences.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/diff-openapi.ts <old-spec> <new-spec>
 *
 * Both YAML and JSON files are accepted.
 *
 * Features:
 *   - Expands all $ref pointers before comparing (different abstraction strategies don't matter)
 *   - Ignores key ordering in objects
 *   - Ignores YAML formatting (multi-line strings, etc.)
 *   - Reports missing/added paths, schema differences, extra/missing fields, etc.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Diff {
  path: string;
  type: "added" | "removed" | "changed" | "type-changed";
  oldValue?: unknown;
  newValue?: unknown;
  details?: string;
}

// ---------------------------------------------------------------------------
// Parsing & $ref resolution
// ---------------------------------------------------------------------------

function loadSpec(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  const parsed =
    ext === ".json" ? JSON.parse(raw) : yaml.load(raw, { json: true });
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Failed to parse ${filePath} as an object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Recursively resolve all `$ref` pointers in-place.
 * Handles circular refs by tracking visited paths.
 */
function resolveRefs(
  node: unknown,
  root: Record<string, unknown>,
  visited: Set<string> = new Set()
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, root, visited));
  }
  if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    if (typeof obj["$ref"] === "string") {
      const refPath = obj["$ref"];
      if (visited.has(refPath)) {
        return { $circular: refPath };
      }
      visited.add(refPath);
      const resolved = followRef(refPath, root);
      const result = resolveRefs(resolved, root, visited);
      visited.delete(refPath);

      // Merge any sibling keys (e.g. description alongside $ref)
      const siblings = Object.keys(obj).filter((k) => k !== "$ref");
      if (siblings.length > 0 && typeof result === "object" && result !== null) {
        const merged = { ...(result as Record<string, unknown>) };
        for (const key of siblings) {
          merged[key] = resolveRefs(obj[key], root, visited);
        }
        return merged;
      }
      return result;
    }
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveRefs(value, root, visited);
    }
    return resolved;
  }
  return node;
}

function followRef(ref: string, root: Record<string, unknown>): unknown {
  if (!ref.startsWith("#/")) {
    // External refs — return as-is (we can't resolve them without fetching)
    return { $externalRef: ref };
  }
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      throw new Error(`Cannot resolve $ref "${ref}" — hit non-object at "${part}"`);
    }
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) {
      throw new Error(`Cannot resolve $ref "${ref}" — "${part}" not found`);
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Deep comparison
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function deepDiff(
  oldVal: unknown,
  newVal: unknown,
  currentPath: string,
  diffs: Diff[]
): void {
  // Identical primitives / strict equality
  if (oldVal === newVal) return;

  const oldType = typeName(oldVal);
  const newType = typeName(newVal);

  // Type mismatch
  if (oldType !== newType) {
    diffs.push({
      path: currentPath,
      type: "type-changed",
      details: `${oldType} → ${newType}`,
      oldValue: summarize(oldVal),
      newValue: summarize(newVal),
    });
    return;
  }

  // Both arrays
  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    diffArrays(oldVal, newVal, currentPath, diffs);
    return;
  }

  // Both objects
  if (isObject(oldVal) && isObject(newVal)) {
    diffObjects(oldVal, newVal, currentPath, diffs);
    return;
  }

  // Primitives that differ
  diffs.push({
    path: currentPath,
    type: "changed",
    oldValue: oldVal,
    newValue: newVal,
  });
}

function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  currentPath: string,
  diffs: Diff[]
): void {
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of allKeys) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    if (!(key in oldObj)) {
      diffs.push({
        path: childPath,
        type: "added",
        newValue: summarize(newObj[key]),
      });
    } else if (!(key in newObj)) {
      diffs.push({
        path: childPath,
        type: "removed",
        oldValue: summarize(oldObj[key]),
      });
    } else {
      deepDiff(oldObj[key], newObj[key], childPath, diffs);
    }
  }
}

/**
 * For arrays of objects that have an identifiable key (like paths with operationId,
 * or enum values), try to match by identity before falling back to index-based diff.
 */
function diffArrays(
  oldArr: unknown[],
  newArr: unknown[],
  currentPath: string,
  diffs: Diff[]
): void {
  // Try to match by a common identity key for arrays of objects
  const identityKey = findIdentityKey(oldArr, newArr);
  if (identityKey) {
    diffArrayByKey(oldArr, newArr, currentPath, diffs, identityKey);
    return;
  }

  // For arrays of primitives, compare as sets if all items are primitives
  if (
    oldArr.every((v) => typeof v !== "object") &&
    newArr.every((v) => typeof v !== "object")
  ) {
    const oldSet = new Set(oldArr.map(String));
    const newSet = new Set(newArr.map(String));
    for (const v of oldArr) {
      if (!newSet.has(String(v))) {
        diffs.push({
          path: `${currentPath}[]`,
          type: "removed",
          oldValue: v,
        });
      }
    }
    for (const v of newArr) {
      if (!oldSet.has(String(v))) {
        diffs.push({
          path: `${currentPath}[]`,
          type: "added",
          newValue: v,
        });
      }
    }
    return;
  }

  // Fallback: index-based diff
  const maxLen = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < maxLen; i++) {
    const childPath = `${currentPath}[${i}]`;
    if (i >= oldArr.length) {
      diffs.push({
        path: childPath,
        type: "added",
        newValue: summarize(newArr[i]),
      });
    } else if (i >= newArr.length) {
      diffs.push({
        path: childPath,
        type: "removed",
        oldValue: summarize(oldArr[i]),
      });
    } else {
      deepDiff(oldArr[i], newArr[i], childPath, diffs);
    }
  }
}

function findIdentityKey(
  oldArr: unknown[],
  newArr: unknown[]
): string | null {
  const candidates = ["operationId", "name", "id", "url", "in"];
  for (const key of candidates) {
    const oldVals = oldArr
      .filter(isObject)
      .map((o) => o[key])
      .filter((v) => typeof v === "string");
    const newVals = newArr
      .filter(isObject)
      .map((o) => o[key])
      .filter((v) => typeof v === "string");
    // Good identity key: most items have it and values are unique
    if (
      oldVals.length > oldArr.length * 0.5 &&
      newVals.length > newArr.length * 0.5 &&
      new Set(oldVals).size === oldVals.length &&
      new Set(newVals).size === newVals.length
    ) {
      return key;
    }
  }
  return null;
}

function diffArrayByKey(
  oldArr: unknown[],
  newArr: unknown[],
  currentPath: string,
  diffs: Diff[],
  key: string
): void {
  const oldMap = new Map<string, unknown>();
  const newMap = new Map<string, unknown>();
  for (const item of oldArr) {
    if (isObject(item) && typeof item[key] === "string") {
      oldMap.set(item[key] as string, item);
    }
  }
  for (const item of newArr) {
    if (isObject(item) && typeof item[key] === "string") {
      newMap.set(item[key] as string, item);
    }
  }
  for (const [id, oldItem] of oldMap) {
    const childPath = `${currentPath}[${key}=${id}]`;
    if (!newMap.has(id)) {
      diffs.push({ path: childPath, type: "removed", oldValue: summarize(oldItem) });
    } else {
      deepDiff(oldItem, newMap.get(id), childPath, diffs);
    }
  }
  for (const [id, newItem] of newMap) {
    if (!oldMap.has(id)) {
      const childPath = `${currentPath}[${key}=${id}]`;
      diffs.push({ path: childPath, type: "added", newValue: summarize(newItem) });
    }
  }
}

// ---------------------------------------------------------------------------
// Summarize values for readable output
// ---------------------------------------------------------------------------

function summarize(val: unknown, maxLen = 120): unknown {
  if (val === undefined || val === null) return val;
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return val;
  }
  const json = JSON.stringify(val);
  if (json.length <= maxLen) return JSON.parse(json);
  if (Array.isArray(val)) return `[Array(${val.length})]`;
  if (isObject(val)) {
    const keys = Object.keys(val);
    return `{${keys.slice(0, 5).join(", ")}${keys.length > 5 ? `, ... (${keys.length} keys)` : ""}}`;
  }
  return json.slice(0, maxLen) + "…";
}

// ---------------------------------------------------------------------------
// Filtering for meaningful OpenAPI differences
// ---------------------------------------------------------------------------

/** Keys that are cosmetic / non-functional in OpenAPI context */
const IGNORED_KEYS = new Set([
  "x-codeSamples",
  "x-code-samples",
  "x-logo",
  "x-tagGroups",
]);

function filterIgnoredKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(filterIgnoredKeys);
  }
  if (isObject(obj)) {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (IGNORED_KEYS.has(key)) continue;
      filtered[key] = filterIgnoredKeys(value);
    }
    return filtered;
  }
  return obj;
}

/**
 * Strip the top-level `components` / `definitions` keys since we've already
 * inlined all $refs. Also strip `info.version` which often bumps trivially.
 */
function stripMeta(spec: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...spec };
  delete copy["components"];
  delete copy["definitions"];
  delete copy["x-webhooks"];
  // Keep info but drop version
  if (isObject(copy["info"])) {
    const info = { ...(copy["info"] as Record<string, unknown>) };
    delete info["version"];
    copy["info"] = info;
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Grouping & display
// ---------------------------------------------------------------------------

interface GroupedDiffs {
  paths: Diff[];
  schemas: Diff[];
  parameters: Diff[];
  responses: Diff[];
  security: Diff[];
  other: Diff[];
}

function groupDiffs(diffs: Diff[]): GroupedDiffs {
  const groups: GroupedDiffs = {
    paths: [],
    schemas: [],
    parameters: [],
    responses: [],
    security: [],
    other: [],
  };
  for (const d of diffs) {
    if (d.path.startsWith("paths")) groups.paths.push(d);
    else if (
      d.path.startsWith("components.schemas") ||
      d.path.startsWith("definitions")
    )
      groups.schemas.push(d);
    else if (d.path.startsWith("components.parameters"))
      groups.parameters.push(d);
    else if (d.path.startsWith("components.responses"))
      groups.responses.push(d);
    else if (d.path.startsWith("security") || d.path.startsWith("securityDefinitions"))
      groups.security.push(d);
    else groups.other.push(d);
  }
  return groups;
}

const COLORS = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function formatValue(val: unknown): string {
  if (val === undefined) return COLORS.dim("(absent)");
  if (typeof val === "string") return val.length > 80 ? val.slice(0, 80) + "…" : val;
  return JSON.stringify(val, null, 2).split("\n").slice(0, 4).join("\n");
}

function printDiff(d: Diff): void {
  const icon =
    d.type === "added"
      ? COLORS.green("+ ")
      : d.type === "removed"
      ? COLORS.red("- ")
      : COLORS.yellow("~ ");

  const label =
    d.type === "added"
      ? COLORS.green("ADDED")
      : d.type === "removed"
      ? COLORS.red("REMOVED")
      : d.type === "type-changed"
      ? COLORS.yellow("TYPE CHANGED")
      : COLORS.yellow("CHANGED");

  console.log(`${icon}${COLORS.bold(d.path)}  [${label}]`);

  if (d.details) {
    console.log(`  ${COLORS.dim(d.details)}`);
  }
  if (d.type === "changed" || d.type === "type-changed") {
    console.log(`  old: ${COLORS.red(formatValue(d.oldValue))}`);
    console.log(`  new: ${COLORS.green(formatValue(d.newValue))}`);
  } else if (d.type === "added") {
    console.log(`  ${COLORS.green(formatValue(d.newValue))}`);
  } else if (d.type === "removed") {
    console.log(`  ${COLORS.red(formatValue(d.oldValue))}`);
  }
}

function printSection(title: string, diffs: Diff[]): void {
  if (diffs.length === 0) return;
  console.log("");
  console.log(COLORS.cyan(`═══ ${title} (${diffs.length} diff${diffs.length === 1 ? "" : "s"}) ═══`));
  console.log("");

  // For paths, group by HTTP path for readability
  if (title === "Paths") {
    const byPath = new Map<string, Diff[]>();
    for (const d of diffs) {
      // Extract the path portion: "paths./api/v1/foo.get...." -> "/api/v1/foo"
      const match = d.path.match(/^paths\.([^.]+)/);
      const key = match ? match[1] : "__other__";
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key)!.push(d);
    }
    for (const [pathKey, pathDiffs] of byPath) {
      console.log(COLORS.bold(`  ${pathKey}`));
      for (const d of pathDiffs) {
        printDiff(d);
      }
      console.log("");
    }
  } else {
    for (const d of diffs) {
      printDiff(d);
    }
  }
}

// ---------------------------------------------------------------------------
// Path-level summary
// ---------------------------------------------------------------------------

function printPathSummary(diffs: Diff[]): void {
  const addedPaths = new Set<string>();
  const removedPaths = new Set<string>();
  const changedPaths = new Set<string>();

  for (const d of diffs) {
    if (!d.path.startsWith("paths.")) continue;
    // Extract "paths./api/v1/foo.get" level
    const parts = d.path.split(".");
    const httpPath = parts[1] || "";
    const method = parts[2] || "";
    const endpoint = method ? `${method.toUpperCase()} ${httpPath}` : httpPath;

    // If the diff is directly at "paths./foo" or "paths./foo.get" level, it's added/removed
    if (parts.length <= 3 && d.type === "added") {
      addedPaths.add(endpoint);
    } else if (parts.length <= 3 && d.type === "removed") {
      removedPaths.add(endpoint);
    } else {
      changedPaths.add(endpoint);
    }
  }

  // Remove from "changed" if already in added/removed
  for (const p of addedPaths) changedPaths.delete(p);
  for (const p of removedPaths) changedPaths.delete(p);

  if (addedPaths.size + removedPaths.size + changedPaths.size === 0) return;

  console.log("");
  console.log(COLORS.cyan("═══ Endpoint Summary ═══"));
  console.log("");
  if (addedPaths.size) {
    console.log(COLORS.green(`  Added (${addedPaths.size}):`));
    for (const p of [...addedPaths].sort()) console.log(COLORS.green(`    + ${p}`));
  }
  if (removedPaths.size) {
    console.log(COLORS.red(`  Removed (${removedPaths.size}):`));
    for (const p of [...removedPaths].sort()) console.log(COLORS.red(`    - ${p}`));
  }
  if (changedPaths.size) {
    console.log(COLORS.yellow(`  Changed (${changedPaths.size}):`));
    for (const p of [...changedPaths].sort()) console.log(COLORS.yellow(`    ~ ${p}`));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: diff-openapi <old-spec> <new-spec> [options]

Compare two OpenAPI spec files and report meaningful differences.
Supports both YAML and JSON formats.

Options:
  --verbose, -v    Show all diffs (don't collapse large sections)
  --json           Output raw diffs as JSON
  --paths-only     Only show path/endpoint differences
  --help, -h       Show this help
`);
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const verbose = args.includes("--verbose") || args.includes("-v");
  const jsonOutput = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");

  const oldPath = args[0];
  const newPath = args[1];

  for (const p of [oldPath, newPath]) {
    if (!fs.existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(1);
    }
  }

  console.log(COLORS.dim(`Old: ${oldPath}`));
  console.log(COLORS.dim(`New: ${newPath}`));
  console.log("");

  // Load and parse
  const oldRaw = loadSpec(oldPath);
  const newRaw = loadSpec(newPath);

  // Resolve $refs
  const oldResolved = resolveRefs(oldRaw, oldRaw) as Record<string, unknown>;
  const newResolved = resolveRefs(newRaw, newRaw) as Record<string, unknown>;

  // Filter ignored keys
  const oldFiltered = filterIgnoredKeys(oldResolved) as Record<string, unknown>;
  const newFiltered = filterIgnoredKeys(newResolved) as Record<string, unknown>;

  // Strip components (already inlined) and cosmetic metadata
  const oldClean = stripMeta(oldFiltered);
  const newClean = stripMeta(newFiltered);

  // Diff
  const diffs: Diff[] = [];
  deepDiff(oldClean, newClean, "", diffs);

  if (diffs.length === 0) {
    console.log(COLORS.green("✓ No meaningful differences found."));
    process.exit(0);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(diffs, null, 2));
    process.exit(diffs.length > 0 ? 1 : 0);
  }

  console.log(
    COLORS.bold(`Found ${diffs.length} difference${diffs.length === 1 ? "" : "s"}`)
  );

  // Print endpoint summary first
  printPathSummary(diffs);

  // Group and display
  const groups = groupDiffs(diffs);

  if (pathsOnly) {
    printSection("Paths", groups.paths);
  } else {
    printSection("Paths", groups.paths);
    printSection("Schemas", groups.schemas);
    printSection("Parameters", groups.parameters);
    printSection("Responses", groups.responses);
    printSection("Security", groups.security);
    printSection("Other", groups.other);
  }

  // Summary
  console.log("");
  console.log(COLORS.bold("Summary:"));
  const added = diffs.filter((d) => d.type === "added").length;
  const removed = diffs.filter((d) => d.type === "removed").length;
  const changed = diffs.filter(
    (d) => d.type === "changed" || d.type === "type-changed"
  ).length;
  if (added) console.log(COLORS.green(`  ${added} added`));
  if (removed) console.log(COLORS.red(`  ${removed} removed`));
  if (changed) console.log(COLORS.yellow(`  ${changed} changed`));
  console.log("");

  if (!verbose && diffs.length > 100) {
    console.log(
      COLORS.dim(
        `Showing all ${diffs.length} diffs. Use --paths-only to focus on endpoints.`
      )
    );
  }

  process.exit(1);
}

main();
