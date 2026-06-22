import { ConstantInterface } from "shared/types/constant";

// A constant's value resolved for a single target environment.
export type ConstantValueMapEntry = { type: "string" | "json"; value: string };
export type ConstantValueMap = Map<string, ConstantValueMapEntry>;

// Reference syntax (matches the `key` slug charset): `@const:<key>`.
// String constants are interpolated via `{{ @const:key }}` inside string
// values; JSON constants substitute a whole value that is exactly
// `{ "@const:key": true }`.
const KEY = "[a-z0-9][a-z0-9_-]*";
// A backtick-wrapped interpolation (escaped → literal) OR a bare interpolation.
const INTERP = new RegExp(
  "`(\\{\\{\\s*@const:" +
    KEY +
    "\\s*\\}\\})`|\\{\\{\\s*@const:(" +
    KEY +
    ")\\s*\\}\\}",
  "g",
);
const PLACEHOLDER_KEY = new RegExp("^@const:(" + KEY + ")$");

// Build the per-environment lookup: `environmentValues[env] ?? value`. A
// constant with no value for the environment (and no default) is omitted, so
// references to it are left verbatim (graceful failure).
export function buildConstantValueMap(
  constants: Pick<
    ConstantInterface,
    "key" | "type" | "value" | "environmentValues"
  >[],
  environment: string,
): ConstantValueMap {
  const map: ConstantValueMap = new Map();
  for (const c of constants) {
    const value = c.environmentValues?.[environment] ?? c.value;
    if (value === undefined) continue;
    map.set(c.key, { type: c.type, value });
  }
  return map;
}

// Interpolate `{{ @const:key }}` references in a single string. Only string
// constants are substituted; type mismatches, unknown keys, and cycles render
// verbatim. A reference wrapped in backticks is emitted literally (without the
// backticks) and never substituted.
function resolveStringRefs(
  str: string,
  map: ConstantValueMap,
  visited: Set<string>,
  onCycle?: (key: string) => void,
): string {
  return str.replace(INTERP, (full, escaped, key) => {
    if (escaped) return escaped;
    const entry = map.get(key);
    if (!entry || entry.type !== "string") return full;
    if (visited.has(key)) {
      onCycle?.(key);
      return full;
    }
    // The constant's value may itself reference other string constants.
    return resolveStringRefs(
      entry.value,
      map,
      new Set([...visited, key]),
      onCycle,
    );
  });
}

// If `obj` is exactly `{ "@const:key": true }`, return its key; else null.
function placeholderKey(obj: Record<string, unknown>): string | null {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  if (obj[keys[0]] !== true) return null;
  const match = keys[0].match(PLACEHOLDER_KEY);
  return match ? match[1] : null;
}

// Recursively resolve constant references in an already-typed value (the shape
// produced by getJSONValue: strings stay strings, JSON becomes objects/arrays).
// Pure — returns a new value, never mutates the input. `onCycle` is invoked with
// the constant key whenever a reference is left unresolved due to a cycle (the
// caller decides how to surface it; the value is rendered verbatim regardless).
export function resolveConstantRefs(
  value: unknown,
  map: ConstantValueMap,
  visited: Set<string> = new Set(),
  onCycle?: (key: string) => void,
): unknown {
  if (typeof value === "string") {
    return resolveStringRefs(value, map, visited, onCycle);
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveConstantRefs(v, map, visited, onCycle));
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const key = placeholderKey(obj);
    if (key !== null) {
      const entry = map.get(key);
      // Unknown key or type mismatch (string constant in a JSON slot) → verbatim.
      if (!entry || entry.type !== "json") return value;
      if (visited.has(key)) {
        onCycle?.(key);
        return value; // cycle → verbatim
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.value);
      } catch {
        return value; // unparseable → verbatim
      }
      // The resolved JSON may itself contain references.
      return resolveConstantRefs(
        parsed,
        map,
        new Set([...visited, key]),
        onCycle,
      );
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveConstantRefs(v, map, visited, onCycle);
    }
    return out;
  }
  return value;
}
