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

// If `k` is a `@const:<key>` property whose value is `true`, return the
// referenced constant key; else null.
function placeholderEntryKey(k: string, v: unknown): string | null {
  if (v !== true) return null;
  const match = k.match(PLACEHOLDER_KEY);
  return match ? match[1] : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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
    const entries = Object.entries(obj);

    // Resolve a `@const:<key>: true` entry to the referenced JSON constant's
    // parsed value (with its own references resolved). Returns null when the key
    // is unknown, the constant isn't JSON, it's part of a cycle, or it doesn't
    // parse — the reference is then left verbatim.
    const resolveEntry = (key: string): { value: unknown } | null => {
      const entry = map.get(key);
      if (!entry || entry.type !== "json") return null;
      if (visited.has(key)) {
        onCycle?.(key);
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.value);
      } catch {
        return null;
      }
      return {
        value: resolveConstantRefs(
          parsed,
          map,
          new Set([...visited, key]),
          onCycle,
        ),
      };
    };

    // Whole-value substitution: an object that is exactly `{ "@const:key": true }`
    // is replaced by the constant's value (object, array, or primitive).
    if (entries.length === 1) {
      const key = placeholderEntryKey(entries[0][0], entries[0][1]);
      if (key !== null) {
        const resolved = resolveEntry(key);
        return resolved ? resolved.value : value;
      }
    }

    // Otherwise resolve each entry in order. A `@const:key: true` entry whose
    // constant resolves to a plain object is SPREAD in place, so entries listed
    // later (including other constants) override its keys. Non-object or
    // unresolved references are left as literal `@const:` keys.
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      const key = placeholderEntryKey(k, v);
      if (key !== null) {
        const resolved = resolveEntry(key);
        if (resolved && isPlainObject(resolved.value)) {
          Object.assign(out, resolved.value);
          continue;
        }
        out[k] = v; // verbatim (unknown, cycle, or non-object constant)
        continue;
      }
      out[k] = resolveConstantRefs(v, map, visited, onCycle);
    }
    return out;
  }
  return value;
}
