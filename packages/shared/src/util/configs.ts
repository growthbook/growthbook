import { SimpleSchema, SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { parsePlainJSONObject } from "./features";

// Inheritance is modeled by a `parent` key on the config, not stored in its
// editable value. The `$extends` directive that drives resolution is synthesized
// from `parent` on demand (see configAsConstant). These helpers bridge the two.

// The lineage parent of a config: its explicit `parent`, falling back to a
// legacy `$extends` ref embedded in the value (for data written before `parent`).
export function getConfigParentKey(config: {
  parent?: string;
  value?: string;
}): string | null {
  if (config.parent) return config.parent;
  const list = parsePlainJSONObject(config.value ?? "")?.[CONSTANT_EXTENDS_KEY];
  if (!Array.isArray(list)) return null;
  const first = list.find((r): r is string => typeof r === "string");
  const m = first?.match(/^@(?:const|config):([a-z0-9][a-z0-9_-]*)$/);
  return m ? m[1] : null;
}

// Drop any `$extends` directive from a JSON-encoded config value (returns
// non-object values unchanged).
export function stripExtends(value: string | undefined): string | undefined {
  if (value === undefined) return value;
  const obj = parsePlainJSONObject(value);
  if (!obj || !(CONSTANT_EXTENDS_KEY in obj)) return value;
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  return JSON.stringify(rest);
}

// Synthesize the resolution value for a config: inject `$extends: ["@config:parent"]`
// so it merges its parent as the base (own keys still win). With no parent, just
// strip any stray `$extends`.
export function withParentExtends(
  value: string | undefined,
  parentKey: string | null,
): string | undefined {
  if (!parentKey) return stripExtends(value);
  const rest = parsePlainJSONObject(value ?? "") ?? {};
  delete rest[CONSTANT_EXTENDS_KEY];
  return JSON.stringify({
    [CONSTANT_EXTENDS_KEY]: [`@config:${parentKey}`],
    ...rest,
  });
}

// A feature value can be "backed by a config": stored as
// `{ "$extends": ["@config:<key>"], ...patch }` where the config is the base
// layer and the value's own keys are an override patch on top. These helpers
// keep the stored string and the (key, patch) split in sync. The `@config:`
// token is an internal detail — the UI/API expose only the key + patch.

// If `value` is config-backed (its first `$extends` entry is a `@config:` ref),
// return that config key; else null.
export function getConfigBackingKey(value: string | undefined): string | null {
  const list = parsePlainJSONObject(value ?? "")?.[CONSTANT_EXTENDS_KEY];
  if (!Array.isArray(list) || !list.length) return null;
  const m =
    typeof list[0] === "string"
      ? list[0].match(/^@config:([a-z0-9][a-z0-9_-]*)$/)
      : null;
  return m ? m[1] : null;
}

// The override patch of a config-backed value: its own keys (everything but the
// `$extends` directive), as a JSON string. Empty object when there is no patch.
export function getConfigBackingPatch(value: string | undefined): string {
  const obj = parsePlainJSONObject(value ?? "");
  if (!obj) return "{}";
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  return JSON.stringify(rest);
}

// Compose a config key + an override patch into the stored value string. The
// config ref is always the first `$extends` entry (the base layer). With no
// config key, returns the patch unchanged (plain value). An unparseable patch is
// treated as an empty object.
export function setConfigBacking(
  configKey: string | null,
  patch: string | undefined,
): string {
  const rest = parsePlainJSONObject(patch ?? "") ?? {};
  delete rest[CONSTANT_EXTENDS_KEY];
  if (!configKey) return JSON.stringify(rest);
  return JSON.stringify({
    [CONSTANT_EXTENDS_KEY]: [`@config:${configKey}`],
    ...rest,
  });
}

// `rootKey` plus every config that descends from it, in BFS order (root first,
// then each level). Builds a children adjacency map once (O(N)) and walks only
// the subtree, keyed off `getConfigParentKey` so legacy `$extends`-only data
// still links up. Cycle-safe. Used to constrain which configs a rule may
// override with (the feature default's config or its children) and to build the
// lineage tree on the config detail page.
export function getConfigSubtree(
  rootKey: string,
  configs: { key: string; parent?: string; value?: string }[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of configs) {
    const parentKey = getConfigParentKey(c);
    if (parentKey === null) continue;
    const list = childrenOf.get(parentKey);
    if (list) list.push(c.key);
    else childrenOf.set(parentKey, [c.key]);
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [rootKey];
  while (queue.length) {
    const key = queue.shift() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
    for (const child of childrenOf.get(key) ?? []) queue.push(child);
  }
  return ordered;
}

// Ensure a value for a config-backed feature carries a config ref. A rule (or
// default value) that doesn't explicitly reference a config implicitly serves
// the feature's base/default config, so we prepend it when the leading
// `@config:` entry is missing. No-op when there's no default config key (a
// non-config feature) or the value already references a config.
export function ensureConfigBacking(
  value: string | undefined,
  defaultConfigKey: string | null,
): string {
  if (!defaultConfigKey) return value ?? "";
  if (getConfigBackingKey(value) !== null) return value ?? "";
  return setConfigBacking(defaultConfigKey, value);
}

// A single config in a lineage chain (base → … → leaf). `value` is the config's
// JSON-encoded object of its own field values; `schema` is the fields this
// config *appends* (the base owns inherited fields).
export type ConfigChainNode = {
  key: string;
  name?: string;
  value?: string;
  schema?: SimpleSchema;
};

// One resolved field for the Configuration editor: its (effective) schema def,
// the value that wins after walking the chain, and which config in the chain set
// it (`source`), or null when no config sets it (falls back to schema default).
export type ResolvedConfigField = {
  key: string;
  field: SchemaField | null;
  value: unknown;
  source: string | null;
};

// Resolve a config lineage chain (ordered base → leaf) into its effective schema
// and per-field resolved values with provenance.
//
// - Effective schema = each node's appended fields accumulated base → leaf. By
//   the no-override rule, field keys don't collide across the chain; if one
//   somehow does, the first (closest-to-base) definition wins.
// - Values = each node's own keys merged base → leaf (deepest wins), so a child
//   override beats its ancestors. `source` is the deepest node that set it.
export function resolveConfigChain(chain: ConfigChainNode[]): {
  effectiveSchema: SchemaField[];
  fields: ResolvedConfigField[];
} {
  const schemaByKey = new Map<string, SchemaField>();
  for (const node of chain) {
    for (const field of node.schema?.fields ?? []) {
      if (!schemaByKey.has(field.key)) schemaByKey.set(field.key, field);
    }
  }

  const valueByKey = new Map<string, { value: unknown; source: string }>();
  for (const node of chain) {
    const obj = parsePlainJSONObject(node.value ?? "") ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$extends") continue;
      valueByKey.set(k, { value: v, source: node.key });
    }
  }

  // Field set = declared schema fields plus any value keys not in the schema
  // (so stray/legacy values still surface in the editor).
  const fieldKeys = [...new Set([...schemaByKey.keys(), ...valueByKey.keys()])];
  const fields: ResolvedConfigField[] = fieldKeys.map((key) => {
    const set = valueByKey.get(key);
    return {
      key,
      field: schemaByKey.get(key) ?? null,
      value: set ? set.value : undefined,
      source: set ? set.source : null,
    };
  });

  return { effectiveSchema: [...schemaByKey.values()], fields };
}
