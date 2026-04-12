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
 *   - Treats common nullable encodings as equivalent (nullable: true vs anyOf/oneOf
 *     with type + null vs OpenAPI 3.1 type: [T, "null"]).
 *   - Drops integer minimum/maximum when set to JS safe-integer limits (±9007199254740991),
 *     which some generators add as no-op bounds.
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
  visited: Set<string> = new Set(),
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
      if (
        siblings.length > 0 &&
        typeof result === "object" &&
        result !== null
      ) {
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
    .map((p) =>
      p
        .replace(/~1/g, "/")
        .replace(/~0/g, "~")
        .replace(/%7B/g, "{")
        .replace(/%7D/g, "}"),
    );
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      throw new Error(
        `Cannot resolve $ref "${ref}" — hit non-object at "${part}"`,
      );
    }
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) {
      throw new Error(
        `Cannot resolve $ref "${parts.join(",")}" — "${part}" not found`,
      );
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
  diffs: Diff[],
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
  diffs: Diff[],
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
  diffs: Diff[],
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

function findIdentityKey(oldArr: unknown[], newArr: unknown[]): string | null {
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
  key: string,
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
      diffs.push({
        path: childPath,
        type: "removed",
        oldValue: summarize(oldItem),
      });
    } else {
      deepDiff(oldItem, newMap.get(id), childPath, diffs);
    }
  }
  for (const [id, newItem] of newMap) {
    if (!oldMap.has(id)) {
      const childPath = `${currentPath}[${key}=${id}]`;
      diffs.push({
        path: childPath,
        type: "added",
        newValue: summarize(newItem),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Summarize values for readable output
// ---------------------------------------------------------------------------

function summarize(val: unknown, maxLen = 120): unknown {
  if (val === undefined || val === null) return val;
  if (
    typeof val === "string" ||
    typeof val === "number" ||
    typeof val === "boolean"
  ) {
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
  "$skipValidatorGeneration",
  "$schema",
  "additionalProperties",
  "propertyNames", // Zod 4 emits propertyNames: {type:"string"} for z.record(); always true
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
 * Some OpenAPI emitters set `minimum` / `maximum` to Number.MIN_SAFE_INTEGER /
 * Number.MAX_SAFE_INTEGER on integers; that is effectively unbounded and causes
 * noisy diffs when the other spec omits those keys.
 */
function stripJsSafeIntegerBoundArtifacts(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(stripJsSafeIntegerBoundArtifacts);
  }
  if (!isObject(val)) return val;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    if (k === "minimum" && v === Number.MIN_SAFE_INTEGER) continue;
    if (k === "maximum" && v === Number.MAX_SAFE_INTEGER) continue;
    out[k] = stripJsSafeIntegerBoundArtifacts(v);
  }
  return out;
}

function isNullOnlyTypeSchema(node: unknown): boolean {
  return isObject(node) && node["type"] === "null";
}

/**
 * Collapse `anyOf` / `oneOf` [ T, { type: "null" } ] (in either order) to
 * `{ ...T, nullable: true }`, and `type: ["string", "null"]` (single non-null
 * type) to `{ type: "string", nullable: true }`, so different OpenAPI/JSON
 * Schema nullable spellings diff cleanly.
 */
function normalizeNullableRepresentations(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(normalizeNullableRepresentations);
  }
  if (!isObject(val)) return val;

  const anyOf = val["anyOf"];
  if (Array.isArray(anyOf)) {
    const normalizedBranches = anyOf.map(normalizeNullableRepresentations);
    const collapsed = tryCollapseTypeNullUnion(
      val,
      normalizedBranches,
      "anyOf",
    );
    if (collapsed) return collapsed;
  }

  const oneOf = val["oneOf"];
  if (Array.isArray(oneOf)) {
    const normalizedBranches = oneOf.map(normalizeNullableRepresentations);
    const collapsed = tryCollapseTypeNullUnion(
      val,
      normalizedBranches,
      "oneOf",
    );
    if (collapsed) return collapsed;
  }

  const t = val["type"];
  if (Array.isArray(t)) {
    const types = t.filter((x): x is string => typeof x === "string");
    const nonNull = types.filter((x) => x !== "null");
    if (types.includes("null") && nonNull.length === 1) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (k === "type") continue;
        out[k] = normalizeNullableRepresentations(v);
      }
      out["type"] = nonNull[0];
      out["nullable"] = true;
      return out;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = normalizeNullableRepresentations(v);
  }
  return out;
}

function tryCollapseTypeNullUnion(
  parent: Record<string, unknown>,
  normalizedBranches: unknown[],
  combinatorKey: "anyOf" | "oneOf",
): Record<string, unknown> | null {
  if (normalizedBranches.length !== 2) return null;

  const nullBranches = normalizedBranches.filter(isNullOnlyTypeSchema);
  const nonNullBranches = normalizedBranches.filter(
    (b) => !isNullOnlyTypeSchema(b),
  );
  if (nullBranches.length !== 1 || nonNullBranches.length !== 1) return null;

  const nonNull = nonNullBranches[0];
  if (!isObject(nonNull)) return null;

  const merged: Record<string, unknown> = {
    ...(nonNull as Record<string, unknown>),
  };
  for (const [k, v] of Object.entries(parent)) {
    if (k === combinatorKey) continue;
    merged[k] = normalizeNullableRepresentations(v);
  }
  merged["nullable"] = true;
  return merged;
}

// ---------------------------------------------------------------------------
// Semantic normalizations — transform equivalent representations into a
// canonical form so they don't produce false-positive diffs.
// ---------------------------------------------------------------------------

/**
 * In OpenAPI, parameters declared at the path level apply to every operation
 * under that path.  Some generators hoist them, others inline them.
 * We normalize by pushing path-level params into each operation.
 */
function hoistPathParameters(spec: unknown): unknown {
  if (!isObject(spec)) return spec;
  const paths = spec["paths"];
  if (!isObject(paths)) return spec;

  const newPaths: Record<string, unknown> = {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) {
      newPaths[pathKey] = pathItem;
      continue;
    }
    const pathParams = Array.isArray(pathItem["parameters"])
      ? pathItem["parameters"]
      : [];
    const newPathItem: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (key === "parameters") continue; // drop path-level params
      if (
        ["get", "post", "put", "delete", "patch", "options", "head"].includes(
          key,
        ) &&
        isObject(value)
      ) {
        // Merge path-level params into operation, operation params win on conflict
        const opParams = Array.isArray(value["parameters"])
          ? value["parameters"]
          : [];
        const opParamKeys = new Set(
          opParams.filter(isObject).map((p) => `${p["in"]}:${p["name"]}`),
        );
        const merged = [
          ...pathParams.filter(
            (p) =>
              isObject(p) && !opParamKeys.has(`${p["in"]}:${p["name"]}`),
          ),
          ...opParams,
        ];
        newPathItem[key] = {
          ...value,
          ...(merged.length > 0 ? { parameters: merged } : {}),
        };
      } else {
        newPathItem[key] = value;
      }
    }
    newPaths[pathKey] = newPathItem;
  }
  return { ...spec, paths: newPaths };
}

/**
 * Unwrap `allOf: [X]` → X recursively.
 * A single-element allOf is an identity wrapper some generators emit.
 */
function collapseSingleAllOf(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(collapseSingleAllOf);
  }
  if (!isObject(val)) return val;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = collapseSingleAllOf(v);
  }

  if (
    Array.isArray(out["allOf"]) &&
    out["allOf"].length === 1 &&
    isObject(out["allOf"][0])
  ) {
    const inner = out["allOf"][0] as Record<string, unknown>;
    const { allOf: _, ...rest } = out;
    // Merge sibling keys with the inner schema, inner wins on conflict
    return { ...rest, ...inner };
  }

  return out;
}

/**
 * OpenAPI 3.0: `{ minimum: N, exclusiveMinimum: true }` means "> N".
 * OpenAPI 3.1 / JSON Schema: `{ exclusiveMinimum: N }` means "> N".
 * Normalize the 3.0 form to the 3.1 form.  Same for maximum.
 */
function normalizeExclusiveMinMax(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(normalizeExclusiveMinMax);
  }
  if (!isObject(val)) return val;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = normalizeExclusiveMinMax(v);
  }

  if (out["exclusiveMinimum"] === true && typeof out["minimum"] === "number") {
    out["exclusiveMinimum"] = out["minimum"];
    delete out["minimum"];
  }
  if (out["exclusiveMaximum"] === true && typeof out["maximum"] === "number") {
    out["exclusiveMaximum"] = out["maximum"];
    delete out["maximum"];
  }

  return out;
}

/**
 * Normalize `{ type: T, enum: [v1, v2, ...] }` to `{ anyOf: [{ const: v1 }, { const: v2 }, ...] }`.
 * Both representations are semantically identical in JSON Schema but generators choose differently.
 * Only applies when enum has 2+ values (single-value enums are effectively const anyway).
 */
function normalizeLiteralEnums(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(normalizeLiteralEnums);
  }
  if (!isObject(val)) return val;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = normalizeLiteralEnums(v);
  }

  if (Array.isArray(out["enum"]) && typeof out["type"] === "string") {
    const enumVals = out["enum"];
    const { type: _, enum: _e, ...rest } = out;
    return {
      ...rest,
      anyOf: enumVals.map((v) => ({ const: v })),
    };
  }

  return out;
}

/**
 * If a schema already has `enum` with all values of the same type, a `type`
 * field is redundant.  Some generators include it, some don't.
 * This is handled by normalizeLiteralEnums above (which strips type+enum
 * and replaces with anyOf), but for schemas that only have enum without type
 * we need to also convert those to the anyOf form for consistency.
 */

/**
 * Normalize invalid OpenAPI types:  `"bool"` → `"boolean"`.
 */
function normalizeInvalidTypes(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(normalizeInvalidTypes);
  }
  if (!isObject(val)) return val;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    if (k === "type" && v === "bool") {
      out[k] = "boolean";
    } else {
      out[k] = normalizeInvalidTypes(v);
    }
  }
  return out;
}

/**
 * Strip `description` from parameter objects (those with `in: "path"` or `in: "query"`).
 * These are additive-only in the new spec — the old spec has no param descriptions.
 */
function stripParameterDescriptions(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(stripParameterDescriptions);
  }
  if (!isObject(val)) return val;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = stripParameterDescriptions(v);
  }

  // If this is a parameter object (has `in` field), strip description
  // at both the parameter level and inside its schema
  if (
    typeof out["in"] === "string" &&
    (out["in"] === "path" || out["in"] === "query")
  ) {
    delete out["description"];
    if (isObject(out["schema"])) {
      const schemaCopy = { ...(out["schema"] as Record<string, unknown>) };
      delete schemaCopy["description"];
      out["schema"] = schemaCopy;
    }
  }

  return out;
}

/**
 * Strip the top-level `components` / `definitions` keys since we've already
 * inlined all $refs.
 */
function stripMeta(spec: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...spec };
  delete copy["components"];
  delete copy["definitions"];
  delete copy["x-webhooks"];
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
    else if (
      d.path.startsWith("security") ||
      d.path.startsWith("securityDefinitions")
    )
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
  if (typeof val === "string")
    return val.length > 80 ? val.slice(0, 80) + "…" : val;
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
  console.log(
    COLORS.cyan(
      `═══ ${title} (${diffs.length} diff${diffs.length === 1 ? "" : "s"}) ═══`,
    ),
  );
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
    for (const p of [...addedPaths].sort())
      console.log(COLORS.green(`    + ${p}`));
  }
  if (removedPaths.size) {
    console.log(COLORS.red(`  Removed (${removedPaths.size}):`));
    for (const p of [...removedPaths].sort())
      console.log(COLORS.red(`    - ${p}`));
  }
  if (changedPaths.size) {
    console.log(COLORS.yellow(`  Changed (${changedPaths.size}):`));
    for (const p of [...changedPaths].sort())
      console.log(COLORS.yellow(`    ~ ${p}`));
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

  // Apply semantic normalizations to both specs
  const normalize = (spec: unknown): unknown => {
    let s = spec;
    s = hoistPathParameters(s);
    s = stripJsSafeIntegerBoundArtifacts(s);
    s = normalizeNullableRepresentations(s);
    s = collapseSingleAllOf(s);
    s = normalizeExclusiveMinMax(s);
    s = normalizeLiteralEnums(s);
    s = normalizeInvalidTypes(s);
    s = stripParameterDescriptions(s);
    return s;
  };

  const oldNorm = normalize(oldClean);
  const newNorm = normalize(newClean);

  // Diff
  const diffs: Diff[] = [];
  deepDiff(oldNorm, newNorm, "", diffs);

  if (diffs.length === 0) {
    console.log(COLORS.green("✓ No meaningful differences found."));
    process.exit(0);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(diffs, null, 2));
    process.exit(diffs.length > 0 ? 1 : 0);
  }

  console.log(
    COLORS.bold(
      `Found ${diffs.length} difference${diffs.length === 1 ? "" : "s"}`,
    ),
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
    (d) => d.type === "changed" || d.type === "type-changed",
  ).length;
  if (added) console.log(COLORS.green(`  ${added} added`));
  if (removed) console.log(COLORS.red(`  ${removed} removed`));
  if (changed) console.log(COLORS.yellow(`  ${changed} changed`));
  console.log("");

  if (!verbose && diffs.length > 100) {
    console.log(
      COLORS.dim(
        `Showing all ${diffs.length} diffs. Use --paths-only to focus on endpoints.`,
      ),
    );
  }

  process.exit(1);
}

main();
