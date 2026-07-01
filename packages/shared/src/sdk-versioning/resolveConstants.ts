import { ConstantInterface } from "shared/types/constant";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { deepMergePatch, isUnsafeMergeKey } from "../util/deep-merge";

// Which namespace an entry belongs to. References are namespaced (`@const:` vs
// `@config:`) and the value map is keyed by `source:key`, so the two namespaces
// are independent — a constant and a config may share a bare key.
export type ConstantSource = "constant" | "config";

// A constant's value resolved for a single target environment. `archived`
// entries carry no usable value — references to them are scrubbed from the
// payload entirely (see buildConstantValueMap). `project` is the constant's
// single project ("" = global); a reference from a feature in a different
// project is also scrubbed (see `isScrubbed`).
export type ConstantValueMapEntry = {
  // Configs resolve identically to `json` and are coerced to `type: "json"`
  // when merged into this map (see the resolution-universe loader), so only two
  // surface types exist here.
  type: "string" | "json";
  // The namespace this entry belongs to. The map is keyed by `source:key`
  // (see mapKey/buildConstantValueMap), so the source also disambiguates a key
  // shared by a constant and a config. Optional for hand-built maps; absent is
  // treated as `"constant"`.
  source?: ConstantSource;
  value: string;
  project?: string;
  archived?: boolean;
  // The parsed JSON value, computed once at map-build time so a constant
  // referenced from many features/sites isn't re-`JSON.parse`d on every
  // `$extends` resolution. Only set for non-archived `json` entries whose value
  // parses; `undefined` otherwise (string constants, archived, or unparseable).
  parsed?: unknown;
};
export type ConstantValueMap = Map<string, ConstantValueMapEntry>;

// Reference syntax (matches the `key` slug charset): `@const:<key>`.
// String constants are interpolated via `{{ @const:key }}` inside string
// values. JSON (object) constants are composed via an `$extends` array of
// references — `{ "$extends": ["@const:base", "@const:more"], "own": 1 }` — which
// merges each referenced object (later refs override earlier) and then lets the
// object's own keys override.
const KEY = "[a-z0-9][a-z0-9_-]*";
// Reference namespace: `@const:` (constants) or `@config:` (configs).
const NS = "(?:const|config)";
// The property name that carries the list of references to merge.
export const EXTENDS_KEY = CONSTANT_EXTENDS_KEY;
// A backtick-wrapped interpolation (escaped → literal) OR a bare interpolation.
// For the bare form, group 2 = namespace, group 3 = key.
const INTERP = new RegExp(
  "`(\\{\\{\\s*@" +
    NS +
    ":" +
    KEY +
    "\\s*\\}\\})`|\\{\\{\\s*@(const|config):(" +
    KEY +
    ")\\s*\\}\\}",
  "g",
);
// Group 1 = namespace, group 2 = key.
const PLACEHOLDER_KEY = new RegExp("^@(const|config):(" + KEY + ")$");

const nsToSource = (ns: string): ConstantSource =>
  ns === "config" ? "config" : "constant";

// Value-map key: namespaced by source so a constant and a config may share a
// bare key without colliding. `@const:foo` resolves `constant:foo` and
// `@config:foo` resolves `config:foo` — the two namespaces never overwrite each
// other in the map, even with identical keys.
const mapKey = (source: ConstantSource, key: string): string =>
  `${source}:${key}`;

// Build the per-environment lookup: `environmentValues[env] ?? value`. A
// constant with no value for the environment (and no default) is omitted, so
// references to it are left verbatim (graceful failure).
//
// Archived constants are recorded with `archived: true` (regardless of value)
// so their references are stripped from the payload rather than resolved or
// left verbatim — archiving a constant should remove it from feature values,
// not leak a stale value or a raw `{{ @const:... }}` template.
export function buildConstantValueMap(
  constants: (Pick<
    ConstantInterface,
    "key" | "type" | "value" | "environmentValues" | "archived" | "project"
  > & { source?: ConstantSource })[],
  environment: string,
): ConstantValueMap {
  const map: ConstantValueMap = new Map();
  for (const c of constants) {
    const source: ConstantSource = c.source ?? "constant";
    if (c.archived) {
      map.set(mapKey(source, c.key), {
        type: c.type,
        source,
        value: "",
        project: c.project || "",
        archived: true,
      });
      continue;
    }
    const value = c.environmentValues?.[environment] ?? c.value;
    if (value === undefined) continue;
    // Parse `json` values once up front so `$extends` resolution can reuse it.
    let parsed: unknown;
    if (c.type === "json") {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
    }
    map.set(mapKey(source, c.key), {
      type: c.type,
      source,
      value,
      project: c.project || "",
      parsed,
    });
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
  return str.replace(INTERP, (full, escaped, ns, key) => {
    if (escaped) return escaped;
    // The map is namespaced by source, so a `@const:`/`@config:` ref only ever
    // finds a matching-source entry (no cross-namespace check needed).
    const mk = mapKey(nsToSource(ns), key);
    const entry = ctx.map.get(mk);
    if (!entry) return full;
    // Archived or out-of-project-scope: strip the reference entirely (any type)
    // rather than leaking a raw `{{ @const:... }}` template into the value.
    if (isScrubbed(entry, ctx)) return "";
    if (entry.type !== "string") return full;
    if (visited.has(mk)) {
      ctx.onCycle?.(key);
      return full;
    }
    const cached = ctx.cache.get(mk);
    if (cached !== undefined) return cached as string;
    // The constant's value may itself reference other string constants.
    const resolved = resolveStringRefs(
      entry.value,
      new Set([...visited, mk]),
      ctx,
    );
    ctx.cache.set(mk, resolved);
    return resolved;
  });
}

// If `ref` is a `@const:<key>`/`@config:<key>` reference string, return its
// namespace source + key; else null.
function extendsRef(
  ref: unknown,
): { source: ConstantSource; key: string } | null {
  if (typeof ref !== "string") return null;
  const match = ref.match(PLACEHOLDER_KEY);
  return match ? { source: nsToSource(match[1]), key: match[2] } : null;
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
    const resolveExtendsRef = (
      source: ConstantSource,
      key: string,
    ): Record<string, unknown> | null => {
      // The map is namespaced by source, so the lookup itself enforces that a
      // `@config:` ref only resolves a config (and `@const:` only a constant).
      const mk = mapKey(source, key);
      const entry = ctx.map.get(mk);
      if (!entry || entry.type !== "json" || isScrubbed(entry, ctx))
        return null;
      if (visited.has(mk)) {
        ctx.onCycle?.(key);
        return null;
      }
      if (ctx.cache.has(mk)) {
        const cached = ctx.cache.get(mk);
        return isPlainObject(cached) ? cached : null;
      }
      // Reuse the value parsed once at map-build time (buildConstantValueMap).
      // Fall back to parsing here for maps built without it (`null` is a valid
      // parsed value, so only `undefined` triggers the fallback).
      let parsed = entry.parsed;
      if (parsed === undefined) {
        try {
          parsed = JSON.parse(entry.value);
        } catch {
          return null;
        }
      }
      const resolved = resolveValue(parsed, new Set([...visited, mk]), ctx);
      // Memoize per pass. Caveat: if this node is first resolved while sitting
      // beneath a cycle edge, the back-reference was cut (→ null) and the cached
      // value is truncated; an independent, non-cyclic referrer in the same pass
      // would then reuse that truncated value. Accepted: cycles are rejected at
      // write time (assertNoReferenceCycle / ConfigModel.assertNoCycle), so a
      // stored graph can't actually contain one. See resolveConstants.test.ts.
      ctx.cache.set(mk, resolved);
      return isPlainObject(resolved) ? resolved : null;
    };

    const out: Record<string, unknown> = {};

    // `$extends`: merge each referenced object in array order (later refs
    // override earlier) as the base. Own keys (below) override the merged base,
    // regardless of where `$extends` appears in the object.
    const extendsList = obj[EXTENDS_KEY];
    if (Array.isArray(extendsList)) {
      for (const ref of extendsList) {
        // Advanced escape hatch: an inline object literal in the `$extends`
        // list merges as a layer at its array position (so a later reference
        // can override it — something own keys, which always win, can't do).
        // Resolved recursively so nested references/`$extends` inside it work.
        if (isPlainObject(ref)) {
          const resolvedInline = resolveValue(ref, visited, ctx);
          if (isPlainObject(resolvedInline)) Object.assign(out, resolvedInline);
          continue;
        }
        const parsed = extendsRef(ref);
        if (parsed === null) continue;
        const resolved = resolveExtendsRef(parsed.source, parsed.key);
        if (resolved) Object.assign(out, resolved);
      }
    }

    // Own keys deep-merge (targeted patch) onto the merged base — a value
    // restates only the leaves it changes. Skip `$extends` itself when used as a
    // merge directive (an array); otherwise treat it as a normal key. A
    // backtick-escaped reserved key (`` `$extends` ``) emits as the literal key
    // it escapes, so a genuine data key named `$extends` is expressible. An own
    // key whose value is itself a `$extends` chunk is applied wholesale (atomic).
    const ESCAPED_EXTENDS_KEY = "`" + EXTENDS_KEY + "`";
    for (const [k, v] of Object.entries(obj)) {
      if (k === EXTENDS_KEY && Array.isArray(extendsList)) continue;
      const outKey = k === ESCAPED_EXTENDS_KEY ? EXTENDS_KEY : k;
      if (isUnsafeMergeKey(outKey)) continue;
      const resolved = resolveValue(v, visited, ctx);
      const isChunk = isPlainObject(v) && EXTENDS_KEY in v;
      out[outKey] = isChunk ? resolved : deepMergePatch(out[outKey], resolved);
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
