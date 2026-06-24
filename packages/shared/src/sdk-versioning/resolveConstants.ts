import { ConstantInterface } from "shared/types/constant";
import { CONSTANT_EXTENDS_KEY } from "../constants";

// A constant's value resolved for a single target environment. `archived`
// entries carry no usable value — references to them are scrubbed from the
// payload entirely (see buildConstantValueMap). `project` is the constant's
// single project ("" = global); a reference from a feature in a different
// project is also scrubbed (see `isScrubbed`).
export type ConstantValueMapEntry = {
  type: "string" | "json";
  value: string;
  project?: string;
  archived?: boolean;
};
export type ConstantValueMap = Map<string, ConstantValueMapEntry>;

// Reference syntax (matches the `key` slug charset): `@const:<key>`.
// String constants are interpolated via `{{ @const:key }}` inside string
// values. JSON (object) constants are composed via an `$extends` array of
// references — `{ "$extends": ["@const:base", "@const:more"], "own": 1 }` — which
// merges each referenced object (later refs override earlier) and then lets the
// object's own keys override.
const KEY = "[a-z0-9][a-z0-9_-]*";
// The property name that carries the list of JSON constant references to merge.
export const EXTENDS_KEY = CONSTANT_EXTENDS_KEY;
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
//
// Archived constants are recorded with `archived: true` (regardless of value)
// so their references are stripped from the payload rather than resolved or
// left verbatim — archiving a constant should remove it from feature values,
// not leak a stale value or a raw `{{ @const:... }}` template.
export function buildConstantValueMap(
  constants: Pick<
    ConstantInterface,
    "key" | "type" | "value" | "environmentValues" | "archived" | "project"
  >[],
  environment: string,
): ConstantValueMap {
  const map: ConstantValueMap = new Map();
  for (const c of constants) {
    if (c.archived) {
      map.set(c.key, {
        type: c.type,
        value: "",
        project: c.project || "",
        archived: true,
      });
      continue;
    }
    const value = c.environmentValues?.[environment] ?? c.value;
    if (value === undefined) continue;
    map.set(c.key, { type: c.type, value, project: c.project || "" });
  }
  return map;
}

// Shared state for a single top-level resolve pass: the lookup map, the cycle
// callback, the resolving feature's project (for scope checks), and a per-pass
// memo cache (key → resolved value) so a constant referenced many times in a
// fan-out graph is only resolved once — without it, a diamond reference graph
// re-resolves exponentially.
type ResolveContext = {
  map: ConstantValueMap;
  onCycle?: (key: string) => void;
  featureProject: string;
  cache: Map<string, unknown>;
};

// A reference is scrubbed (removed, not resolved or left verbatim) when the
// constant is archived OR is scoped to a different project than the resolving
// feature. A global constant (no project) is usable everywhere.
function isScrubbed(
  entry: ConstantValueMapEntry,
  ctx: ResolveContext,
): boolean {
  return (
    !!entry.archived ||
    (!!entry.project && entry.project !== ctx.featureProject)
  );
}

// Interpolate `{{ @const:key }}` references in a single string. Only string
// constants are substituted; type mismatches, unknown keys, and cycles render
// verbatim. A reference wrapped in backticks is emitted literally (without the
// backticks) and never substituted.
function resolveStringRefs(
  str: string,
  visited: Set<string>,
  ctx: ResolveContext,
): string {
  return str.replace(INTERP, (full, escaped, key) => {
    if (escaped) return escaped;
    const entry = ctx.map.get(key);
    if (!entry) return full;
    // Archived or out-of-project-scope: strip the reference entirely (any type)
    // rather than leaking a raw `{{ @const:... }}` template into the value.
    if (isScrubbed(entry, ctx)) return "";
    if (entry.type !== "string") return full;
    if (visited.has(key)) {
      ctx.onCycle?.(key);
      return full;
    }
    const cached = ctx.cache.get(key);
    if (cached !== undefined) return cached as string;
    // The constant's value may itself reference other string constants.
    const resolved = resolveStringRefs(
      entry.value,
      new Set([...visited, key]),
      ctx,
    );
    ctx.cache.set(key, resolved);
    return resolved;
  });
}

// If `ref` is a `@const:<key>` reference string, return the key; else null.
function extendsRefKey(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const match = ref.match(PLACEHOLDER_KEY);
  return match ? match[1] : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function resolveValue(
  value: unknown,
  visited: Set<string>,
  ctx: ResolveContext,
): unknown {
  if (typeof value === "string") {
    return resolveStringRefs(value, visited, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, visited, ctx));
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Resolve a referenced JSON (object) constant to its parsed, recursively
    // resolved value. Returns null when unknown, not JSON, scrubbed
    // (archived/out-of-scope), part of a cycle, non-parseable, or not an object.
    // Memoized per pass.
    const resolveExtendsRef = (key: string): Record<string, unknown> | null => {
      const entry = ctx.map.get(key);
      if (!entry || entry.type !== "json" || isScrubbed(entry, ctx))
        return null;
      if (visited.has(key)) {
        ctx.onCycle?.(key);
        return null;
      }
      if (ctx.cache.has(key)) {
        const cached = ctx.cache.get(key);
        return isPlainObject(cached) ? cached : null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.value);
      } catch {
        return null;
      }
      const resolved = resolveValue(parsed, new Set([...visited, key]), ctx);
      ctx.cache.set(key, resolved);
      return isPlainObject(resolved) ? resolved : null;
    };

    const out: Record<string, unknown> = {};

    // `$extends`: merge each referenced object in array order (later refs
    // override earlier) as the base. Own keys (below) override the merged base,
    // regardless of where `$extends` appears in the object.
    const extendsList = obj[EXTENDS_KEY];
    if (Array.isArray(extendsList)) {
      for (const ref of extendsList) {
        const key = extendsRefKey(ref);
        if (key === null) continue;
        const resolved = resolveExtendsRef(key);
        if (resolved) Object.assign(out, resolved);
      }
    }

    // Own keys override the merged base. Skip `$extends` itself when it was used
    // as a merge directive (an array); otherwise treat it as a normal key.
    for (const [k, v] of Object.entries(obj)) {
      if (k === EXTENDS_KEY && Array.isArray(extendsList)) continue;
      out[k] = resolveValue(v, visited, ctx);
    }
    return out;
  }
  return value;
}

// Recursively resolve constant references in an already-typed value (the shape
// produced by getJSONValue: strings stay strings, JSON becomes objects/arrays).
// Pure — returns a new value, never mutates the input. `onCycle` is invoked with
// the constant key whenever a reference is left unresolved due to a cycle (the
// caller decides how to surface it; the value is rendered verbatim regardless).
// `featureProject` is the project of the feature being resolved — references to
// constants scoped to a different project are scrubbed (cross-project values are
// never disclosed in a payload).
export function resolveConstantRefs(
  value: unknown,
  map: ConstantValueMap,
  visited: Set<string> = new Set(),
  onCycle?: (key: string) => void,
  featureProject?: string,
): unknown {
  return resolveValue(value, visited, {
    map,
    onCycle,
    featureProject: featureProject || "",
    cache: new Map(),
  });
}
