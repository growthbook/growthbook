import { ConstantInterface } from "shared/types/constant";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { deepMergePatch, isUnsafeMergeKey } from "../util/deep-merge";
import {
  selectScopedOverride,
  type ScopedOverrideEntry,
} from "../util/scoped-overrides";

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
  // Config only: the ordered, first-match-wins environment/project-scoped variant
  // selection. When set, resolving this config also deep-merges the matching
  // flavor config's patch as a top layer (see resolveValue). Absent on constants.
  scopedOverrides?: ScopedOverrideEntry[];
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
  > & {
    source?: ConstantSource;
    scopedOverrides?: ScopedOverrideEntry[];
  })[],
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
      ...(c.scopedOverrides?.length
        ? { scopedOverrides: c.scopedOverrides }
        : {}),
    });
  }
  return map;
}

// Shared state for a single top-level resolve pass: the lookup map, the cycle
// callback, the resolving feature's project (for scope checks), and a per-pass
// memo cache (key → resolved value) so a constant referenced many times in a
// fan-out graph is only resolved once — without it, a diamond reference graph
// re-resolves exponentially. `layerCache` memoizes per-config layers (see
// ConfigLayer) the same way.
type ResolveContext = {
  map: ConstantValueMap;
  onCycle?: (key: string) => void;
  featureProject: string;
  // The environment being baked, for scoped-override (env flavor) selection.
  // Undefined = env-agnostic resolution (no env flavors apply; base value only).
  environment?: string;
  cache: Map<string, unknown>;
  layerCache: Map<string, ConfigLayer | null>;
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

// A backtick-escaped reserved key (`` `$extends` ``) emits as the literal key
// it escapes, so a genuine data key named `$extends` is expressible.
const ESCAPED_EXTENDS_KEY = "`" + EXTENDS_KEY + "`";

// Reuse the value parsed once at map-build time (buildConstantValueMap). Fall
// back to parsing here for maps built without it (`null` is a valid parsed
// value, so only `undefined` triggers the fallback). `undefined` = unparseable.
function parsedEntryValue(entry: ConstantValueMapEntry): unknown {
  if (entry.parsed !== undefined) return entry.parsed;
  try {
    return JSON.parse(entry.value);
  } catch {
    return undefined;
  }
}

// Resolve a referenced JSON (object) constant to its parsed, recursively
// resolved value — the whole entry flattened, including its own `$extends`.
// Returns null when unknown, not JSON, scrubbed (archived/out-of-scope), part
// of a cycle, non-parseable, or not an object. Memoized per pass.
function resolveExtendsRef(
  source: ConstantSource,
  key: string,
  visited: Set<string>,
  ctx: ResolveContext,
): Record<string, unknown> | null {
  // The map is namespaced by source, so the lookup itself enforces that a
  // `@config:` ref only resolves a config (and `@const:` only a constant).
  const mk = mapKey(source, key);
  const entry = ctx.map.get(mk);
  if (!entry || entry.type !== "json" || isScrubbed(entry, ctx)) return null;
  if (visited.has(mk)) {
    ctx.onCycle?.(key);
    return null;
  }
  if (ctx.cache.has(mk)) {
    const cached = ctx.cache.get(mk);
    return isPlainObject(cached) ? cached : null;
  }
  const parsed = parsedEntryValue(entry);
  if (parsed === undefined) return null;
  const resolved = resolveValue(parsed, new Set([...visited, mk]), ctx);
  // Memoize per pass. Caveat: if this node is first resolved while sitting
  // beneath a cycle edge, the back-reference was cut (→ null) and the cached
  // value is truncated; an independent, non-cyclic referrer in the same pass
  // would then reuse that truncated value. Accepted: cycles are rejected at
  // write time (assertNoReferenceCycle / ConfigModel.assertNoCycle), so a
  // stored graph can't actually contain one. See resolveConstants.test.ts.
  ctx.cache.set(mk, resolved);
  return isPlainObject(resolved) ? resolved : null;
}

// One config's contribution to a linearized base DAG: `assign` is its own
// non-`@config:` `$extends` entries flattened (existing constant/inline
// semantics — applied wholesale at the layer), then `own` keys merge per-key
// (chunks stay atomic). This mirrors resolveConfigChain, where each node
// contributes only its own value keys.
type ConfigLayer = {
  assign: Record<string, unknown>;
  own: { key: string; value: unknown; isChunk: boolean }[];
};

// The `@config:` base keys declared by a config's own `$extends` list.
function configBaseKeys(parsed: Record<string, unknown>): string[] {
  const list = parsed[EXTENDS_KEY];
  if (!Array.isArray(list)) return [];
  const keys: string[] = [];
  for (const ref of list) {
    const r = extendsRef(ref);
    if (r?.source === "config") keys.push(r.key);
  }
  return keys;
}

// Linearize the config-base DAG rooted at `keys`: post-order DFS, each config
// emitted once (ancestor-first, deduped keeping the first emission) — the same
// order linearizeConfigDag (util/configs.ts) produces, so payload composition
// matches the editor/validation chain semantics. Scrubbed/unknown configs are
// skipped without recursing into their bases (an ancestor only contributes if
// independently reachable); a base already resolving up-stack or a DAG cycle
// is cut with onCycle.
function linearizeConfigLayers(
  keys: string[],
  visited: Set<string>,
  ctx: ResolveContext,
): string[] {
  const out: string[] = [];
  const emitted = new Set<string>();
  const onStack = new Set<string>();
  const visit = (key: string) => {
    if (emitted.has(key)) return;
    const mk = mapKey("config", key);
    if (onStack.has(key) || visited.has(mk)) {
      ctx.onCycle?.(key);
      return;
    }
    const entry = ctx.map.get(mk);
    if (!entry || entry.type !== "json" || isScrubbed(entry, ctx)) return;
    const parsed = parsedEntryValue(entry);
    if (!isPlainObject(parsed)) return;
    onStack.add(key);
    for (const base of configBaseKeys(parsed)) visit(base);
    onStack.delete(key);
    emitted.add(key);
    out.push(key);
  };
  for (const k of keys) visit(k);
  return out;
}

// Build (and memoize) a config's layer. Only called with keys emitted by
// linearizeConfigLayers, so entry/scrub/cycle checks have already passed; the
// re-check just keeps the function total. Shares the truncated-under-cycle
// cache caveat documented in resolveExtendsRef.
function buildConfigLayer(
  key: string,
  visited: Set<string>,
  ctx: ResolveContext,
): ConfigLayer | null {
  const mk = mapKey("config", key);
  const cached = ctx.layerCache.get(mk);
  if (cached !== undefined) return cached;
  const entry = ctx.map.get(mk);
  const parsed =
    entry && entry.type === "json" && !isScrubbed(entry, ctx)
      ? parsedEntryValue(entry)
      : undefined;
  if (!isPlainObject(parsed)) {
    ctx.layerCache.set(mk, null);
    return null;
  }
  const layerVisited = new Set([...visited, mk]);
  const extendsList = parsed[EXTENDS_KEY];
  const assign: Record<string, unknown> = {};
  if (Array.isArray(extendsList)) {
    for (const ref of extendsList) {
      if (isPlainObject(ref)) {
        const resolved = resolveValue(ref, layerVisited, ctx);
        if (isPlainObject(resolved)) Object.assign(assign, resolved);
        continue;
      }
      const r = extendsRef(ref);
      // `@config:` bases are the linearized layers, not part of this one.
      if (!r || r.source === "config") continue;
      const resolved = resolveExtendsRef(r.source, r.key, layerVisited, ctx);
      if (resolved) Object.assign(assign, resolved);
    }
  }
  const own: ConfigLayer["own"] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (k === EXTENDS_KEY && Array.isArray(extendsList)) continue;
    const outKey = k === ESCAPED_EXTENDS_KEY ? EXTENDS_KEY : k;
    if (isUnsafeMergeKey(outKey)) continue;
    own.push({
      key: outKey,
      value: resolveValue(v, layerVisited, ctx),
      isChunk: isPlainObject(v) && EXTENDS_KEY in v,
    });
  }
  const layer = { assign, own };
  ctx.layerCache.set(mk, layer);
  return layer;
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

    const out: Record<string, unknown> = {};

    // `$extends`: `@const:` refs and inline objects flatten wholesale at their
    // array position (later overrides earlier — pre-existing semantics).
    // `@config:` refs instead compose as their linearized base DAG (each config
    // once, ancestor-first, own keys merged per-key — matching
    // resolveConfigChain), with all layers applied at the first `@config:`
    // position. Own keys (below) win last regardless of where `$extends` sits.
    const extendsList = obj[EXTENDS_KEY];
    if (Array.isArray(extendsList)) {
      let configLayersApplied = false;
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
        if (parsed.source === "config") {
          if (configLayersApplied) continue;
          configLayersApplied = true;
          const configKeys: string[] = [];
          for (const r of extendsList) {
            const pr = extendsRef(r);
            if (pr?.source === "config") configKeys.push(pr.key);
          }
          const layerKeys = linearizeConfigLayers(configKeys, visited, ctx);
          const applyLayer = (layer: ConfigLayer) => {
            Object.assign(out, layer.assign);
            for (const e of layer.own) {
              out[e.key] = e.isChunk
                ? e.value
                : deepMergePatch(out[e.key], e.value);
            }
          };
          for (const layerKey of layerKeys) {
            const layer = buildConfigLayer(layerKey, visited, ctx);
            if (!layer) continue;
            applyLayer(layer);
            // Env/project-scoped flavor: after this config layer's own keys, the
            // first matching flavor's patch is deep-merged on top. buildConfigLayer
            // excludes the flavor's `@config` parent (this very layer), so the
            // flavor contributes only its own patch — no double-apply, no loop.
            const flavorKey = selectScopedOverride(
              ctx.map.get(mapKey("config", layerKey))?.scopedOverrides,
              { environment: ctx.environment, project: ctx.featureProject },
              // Skip an archived (or absent) flavor so its env falls back to the
              // next matching override, else the base — never a stale patch.
              (k) => {
                const e = ctx.map.get(mapKey("config", k));
                return !!e && !e.archived;
              },
            );
            const flavor = flavorKey
              ? buildConfigLayer(flavorKey, visited, ctx)
              : null;
            if (flavor) applyLayer(flavor);
          }
          continue;
        }
        const resolved = resolveExtendsRef(
          parsed.source,
          parsed.key,
          visited,
          ctx,
        );
        if (resolved) Object.assign(out, resolved);
      }
    }

    // Own keys deep-merge (targeted patch) onto the merged base — a value
    // restates only the leaves it changes. Skip `$extends` itself when used as
    // a merge directive (an array); otherwise treat it as a normal key. An own
    // key whose value is itself a `$extends` chunk is applied wholesale (atomic).
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
  environment?: string,
): unknown {
  return resolveValue(value, visited, {
    map,
    onCycle,
    featureProject: featureProject || "",
    environment,
    cache: new Map(),
    layerCache: new Map(),
  });
}
