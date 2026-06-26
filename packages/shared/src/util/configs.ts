import { SimpleSchema, SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { parsePlainJSONObject } from "./features";

// Inheritance is modeled by a `parent` key on the config, not stored in its
// editable value. The `$extends` directive that drives resolution is synthesized
// from `parent` on demand (see configToResolvable). These helpers bridge the two.

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

// Drop only the `@config:` directives from a JSON-encoded config value, keeping
// any `@const:` refs (a config may merge a constant as a base layer; config
// lineage lives on `parent`, never in the stored value). Returns non-object
// values unchanged; drops `$extends` entirely if nothing is left.
export function stripConfigExtends(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return value;
  const obj = parsePlainJSONObject(value);
  if (!obj || !(CONSTANT_EXTENDS_KEY in obj)) return value;
  const rest = { ...obj };
  const list = obj[CONSTANT_EXTENDS_KEY];
  const kept = Array.isArray(list)
    ? list.filter((r) => !(typeof r === "string" && r.startsWith("@config:")))
    : [];
  if (kept.length) rest[CONSTANT_EXTENDS_KEY] = kept;
  else delete rest[CONSTANT_EXTENDS_KEY];
  return JSON.stringify(rest);
}

// Synthesize the resolution value for a config: prepend `@config:parent` as the
// first `$extends` entry (the base layer; own keys still win) while preserving
// any `@const:` refs the value declares. Config lineage is owned by `parent`, so
// pre-existing `@config:` entries are dropped. With no parent and no constant
// refs, this strips `$extends` entirely.
export function withParentExtends(
  value: string | undefined,
  parentKey: string | null,
): string | undefined {
  const obj = parsePlainJSONObject(value ?? "") ?? {};
  const prior = obj[CONSTANT_EXTENDS_KEY];
  const constantRefs = Array.isArray(prior)
    ? prior.filter(
        (r): r is string => typeof r === "string" && r.startsWith("@const:"),
      )
    : [];
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  const list = [
    ...(parentKey ? [`@config:${parentKey}`] : []),
    ...constantRefs,
  ];
  if (!list.length) return JSON.stringify(rest);
  return JSON.stringify({ [CONSTANT_EXTENDS_KEY]: list, ...rest });
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

// The override patch of a config-backed value: its own keys plus any non-config
// `$extends` refs (e.g. `@const:`), as a JSON string. "{}" when empty.
export function getConfigBackingPatch(value: string | undefined): string {
  return stripConfigExtends(value) ?? "{}";
}

// Compose a config key + an override patch into the stored value string. The
// config ref is the first `$extends` entry (the base layer); any `@const:` refs
// in the patch are preserved after it. With no config key, returns the patch
// with its `@config:` ref stripped. A non-object patch (e.g. `true`) is returned
// verbatim when detaching, so plain values aren't clobbered.
export function setConfigBacking(
  configKey: string | null,
  patch: string | undefined,
): string {
  const obj = parsePlainJSONObject(patch ?? "");
  if (!obj) {
    if (!configKey) return patch ?? "";
    return JSON.stringify({ [CONSTANT_EXTENDS_KEY]: [`@config:${configKey}`] });
  }
  const prior = obj[CONSTANT_EXTENDS_KEY];
  const constantRefs = Array.isArray(prior)
    ? prior.filter(
        (r): r is string => typeof r === "string" && r.startsWith("@const:"),
      )
    : [];
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  const list = [
    ...(configKey ? [`@config:${configKey}`] : []),
    ...constantRefs,
  ];
  if (!list.length) return JSON.stringify(rest);
  return JSON.stringify({ [CONSTANT_EXTENDS_KEY]: list, ...rest });
}

// `rootKey` plus every config descending from it, in BFS order. Cycle-safe.
// Used to constrain which configs a rule may override with, and to build the
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

// Ensure a config-backed feature's value carries a config ref: a rule that
// doesn't reference one implicitly serves the feature's default config, so
// prepend it. No-op for non-config features or already-backed values.
export function ensureConfigBacking(
  value: string | undefined,
  defaultConfigKey: string | null,
): string {
  if (!defaultConfigKey) return value ?? "";
  if (getConfigBackingKey(value) !== null) return value ?? "";
  return setConfigBacking(defaultConfigKey, value);
}

// Schema field keys owned by a config's ancestors (the closest base wins on a
// key collision). Walks the parent chain via `getConfigParentKey`; cycle-safe.
// Used to enforce "base wins": a descendant may re-value an inherited field but
// must not re-declare its schema, so these keys are stripped from child schemas.
export function getAncestorSchemaKeys(
  config: { parent?: string; value?: string },
  byKey: Map<
    string,
    { parent?: string; value?: string; schema?: SimpleSchema }
  >,
): Set<string> {
  const keys = new Set<string>();
  const seen = new Set<string>();
  let parentKey = getConfigParentKey(config);
  while (parentKey && !seen.has(parentKey)) {
    seen.add(parentKey);
    const parent = byKey.get(parentKey);
    if (!parent) break;
    for (const f of parent.schema?.fields ?? []) keys.add(f.key);
    parentKey = getConfigParentKey(parent);
  }
  return keys;
}

// Remove schema fields whose key is owned by an ancestor (base wins). Returns
// the reconciled field list, or null when nothing changes (no collisions).
export function stripAncestorOwnedFields(
  schema: SimpleSchema | undefined,
  ancestorKeys: Set<string>,
): SchemaField[] | null {
  const fields = schema?.fields ?? [];
  if (!fields.length || !ancestorKeys.size) return null;
  const kept = fields.filter((f) => !ancestorKeys.has(f.key));
  return kept.length === fields.length ? null : kept;
}

// Effective extensibility for a config family. Only the root (base) config's
// explicit `extensible` flag matters; when absent it inherits the org default
// (`configsExtensibleByDefault`), which itself defaults to permissive (true).
// An extensible family permits child configs / feature rules / overrides to add
// keys beyond the declared schema; a non-extensible family is strict.
export function configIsExtensible(
  rootConfig: { extensible?: boolean } | undefined | null,
  orgDefault: boolean | undefined,
): boolean {
  return rootConfig?.extensible ?? orgDefault ?? true;
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
      if (k === CONSTANT_EXTENDS_KEY) continue;
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
