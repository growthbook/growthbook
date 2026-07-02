import { SimpleSchema, SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { parsePlainJSONObject } from "./features";
import {
  collectInvalidConfigValueKeys,
  evaluateInvariants,
  InvariantViolation,
} from "./config-schema";
import { deepMergePatch } from "./deep-merge";

// Inheritance is modeled by a `parent` key (the primary lineage spine) plus an
// optional ordered `extends[]` of mixin config keys, neither stored in the
// editable value. The `$extends` directive that drives resolution is synthesized
// from these on demand (see configToResolvable). These helpers bridge the two.

// The lineage parent of a config: the primary tree spine. Composition mixins
// live in `extends` (see getConfigBaseKeys); the tree shape follows `parent`.
export function getConfigParentKey(config: { parent?: string }): string | null {
  return config.parent || null;
}

// Whether a config is locked (frozen at a published revision). Locking blocks every
// publish path until an explicit unlock; drafts may still be created/edited. `null`
// or absent means unlocked. Shared by the front-end (badge/gating) and back-end
// (publish guards); typed structurally to stay free of a validator import cycle.
export function isConfigLocked(config: {
  lock?: { version: number } | null;
}): boolean {
  return (config.lock ?? null) !== null;
}

// Every base config key for a config, in precedence order: the `parent` spine
// first, then each `extends` mixin in array order. Deduped, order-preserving.
// These become the `@config:` `$extends` entries — later overrides earlier, and
// the config's own keys win last (matches resolveConstantRefs). Used by every
// lineage walk (resolution, schema reconciliation, cycle detection, lineage).
export function getConfigBaseKeys(config: {
  parent?: string;
  extends?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string | null | undefined) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  push(config.parent);
  for (const k of config.extends ?? []) push(k);
  return out;
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

// Synthesize the resolution value for a config: prepend its `@config:` base
// refs (in precedence order — see getConfigBaseKeys) as the first `$extends`
// entries (the base layers; own keys still win) while preserving any `@const:`
// refs the value declares. Config lineage is owned by `parent`/`extends`, so
// pre-existing `@config:` entries in the value are dropped. With no bases and no
// constant refs, this strips `$extends` entirely.
export function withConfigExtends(
  value: string | undefined,
  baseKeys: string[],
): string {
  const obj = parsePlainJSONObject(value ?? "") ?? {};
  const prior = obj[CONSTANT_EXTENDS_KEY];
  const constantRefs = Array.isArray(prior)
    ? prior.filter(
        (r): r is string => typeof r === "string" && r.startsWith("@const:"),
      )
    : [];
  const rest = { ...obj };
  delete rest[CONSTANT_EXTENDS_KEY];
  const list = [...baseKeys.map((k) => `@config:${k}`), ...constantRefs];
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
// Descent follows ALL base edges (parent + extends), so a config reached only
// via a mixin is included. Used to constrain which configs a rule may override
// with, and to build the lineage family on the config detail page.
export function getConfigSubtree(
  rootKey: string,
  configs: { key: string; parent?: string; extends?: string[] }[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of configs) {
    for (const baseKey of getConfigBaseKeys(c)) {
      const list = childrenOf.get(baseKey);
      if (list) list.push(c.key);
      else childrenOf.set(baseKey, [c.key]);
    }
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

// `rootKey` plus every config descending from it via the `parent` spine ONLY
// (ignoring `extends` mixins). Cycle-safe, BFS order. Used to build the lineage
// TREE, whose shape follows `parent`: mixins surface as per-node chips, so the
// tree must not pull in cross-family configs that merely mixin a family member
// (that's what `getConfigSubtree`, which walks every base edge, would do).
export function getConfigSpineSubtree(
  rootKey: string,
  configs: { key: string; parent?: string }[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of configs) {
    const p = getConfigParentKey(c);
    if (!p) continue;
    const list = childrenOf.get(p);
    if (list) list.push(c.key);
    else childrenOf.set(p, [c.key]);
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

// Spine descendants of `configKey` that currently declare a field key this
// config also declares. Publishing makes this config the owner of those keys,
// so the "base wins" cascade strips the redundant definitions from each
// descendant; the detail page surfaces this as an informational preview. One
// entry per colliding descendant, in BFS order.
export function computeConfigReconciliationPreview(
  lineage: {
    key: string;
    parentKey?: string | null;
    name?: string;
    fieldKeys?: string[];
  }[],
  configKey: string,
  ownSchemaKeys: string[],
): { name: string; keys: string[] }[] {
  if (!ownSchemaKeys.length) return [];
  const byKey = new Map(lineage.map((n) => [n.key, n]));
  const ownKeys = new Set(ownSchemaKeys);
  const descendants = getConfigSpineSubtree(
    configKey,
    lineage.map((n) => ({ key: n.key, parent: n.parentKey ?? undefined })),
  ).filter((k) => k !== configKey);
  const hits: { name: string; keys: string[] }[] = [];
  for (const k of descendants) {
    const node = byKey.get(k);
    const collide = (node?.fieldKeys ?? []).filter((fk) => ownKeys.has(fk));
    if (collide.length) hits.push({ name: node?.name ?? k, keys: collide });
  }
  return hits;
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

// Every ancestor config key across the whole base DAG (parent + every
// `extends` mixin, transitively). Cycle-safe. Dangling base keys are included:
// they still name the intended ancestor even if that config no longer resolves.
// Drives family-scoped custom-hook matching ("this config and its descendants").
export function getConfigAncestorKeys(
  config: { parent?: string; extends?: string[] },
  byKey: Map<string, { parent?: string; extends?: string[] }>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...getConfigBaseKeys(config)];
  while (stack.length) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = byKey.get(key);
    if (!base) continue;
    for (const b of getConfigBaseKeys(base)) stack.push(b);
  }
  return seen;
}

// Schema field keys owned by a config's ancestors across the whole base DAG
// (parent + every `extends` mixin, transitively). The base wins on a key
// collision. Cycle-safe. Used to enforce "base wins": a descendant may re-value
// an inherited field but must not re-declare its schema, so these keys are
// stripped from child schemas.
export function getAncestorSchemaKeys(
  config: { parent?: string; extends?: string[] },
  byKey: Map<
    string,
    { parent?: string; extends?: string[]; schema?: SimpleSchema }
  >,
): Set<string> {
  const keys = new Set<string>();
  const seen = new Set<string>();
  const stack = [...getConfigBaseKeys(config)];
  while (stack.length) {
    const baseKey = stack.pop() as string;
    if (seen.has(baseKey)) continue;
    seen.add(baseKey);
    const base = byKey.get(baseKey);
    if (!base) continue;
    for (const f of base.schema?.fields ?? []) keys.add(f.key);
    for (const b of getConfigBaseKeys(base)) stack.push(b);
  }
  return keys;
}

// A config (with its lineage edges) keyed for DAG walks.
type ConfigDagNode = ConfigChainNode & {
  parent?: string;
  extends?: string[];
};

// Linearize a config's base DAG into an ordered base → leaf chain for
// `resolveConfigChain` (which merges last-wins for values, first-seen-wins for
// schema). Post-order DFS over `[parent, ...extends]`: a node is emitted only
// after all its bases, deduped keeping the first emission, so a diamond base
// appears once (before everything that depends on it). Cycle-safe.
export function linearizeConfigDag(
  leafKey: string,
  byKey: Map<string, ConfigDagNode>,
): ConfigChainNode[] {
  const out: ConfigChainNode[] = [];
  const emitted = new Set<string>();
  const onStack = new Set<string>();
  const visit = (key: string) => {
    if (emitted.has(key) || onStack.has(key)) return;
    const node = byKey.get(key);
    if (!node) return;
    onStack.add(key);
    for (const base of getConfigBaseKeys(node)) visit(base);
    onStack.delete(key);
    emitted.add(key);
    out.push({
      key: node.key,
      name: node.name,
      value: node.value,
      schema: node.schema,
    });
  };
  visit(leafKey);
  return out;
}

// The root of a config's `parent` spine — walk `parent` only, ignoring `extends`
// mixins. This is the config whose `extensible` checkbox governs the family's
// extensibility; mixin bases' extensibility is intentionally ignored under
// composition (the spine root's checkbox is the single source of truth).
export function getConfigSpineRootKey(
  leafKey: string,
  byKey: Map<string, { key: string; parent?: string }>,
): string {
  let rootKey = leafKey;
  const seen = new Set<string>([leafKey]);
  let cur = byKey.get(leafKey);
  while (cur?.parent && !seen.has(cur.parent)) {
    seen.add(cur.parent);
    const p = byKey.get(cur.parent);
    if (!p) break;
    rootKey = p.key;
    cur = p;
  }
  return rootKey;
}

// Field keys owned by two or more of a leaf's bases that are NOT in an
// ancestor/descendant relationship (sibling branches of the composition DAG).
// This is the multi-base analog of the linear "a child can't redeclare a
// parent's field" rule: every effective field key must be owned by exactly one
// config. Pure key-ownership — no type comparison; ANY duplicate ownership is a
// conflict. Returns `{ key, owners }` per conflicting field (empty = none).
//
// Only the leaf's BASES are considered (not the leaf's own schema): a collision
// between the leaf and one of its bases is the existing ancestor case, resolved
// by `getAncestorSchemaKeys`/`stripAncestorOwnedFields` (base wins).
export function findSiblingSchemaConflicts(
  leaf: { parent?: string; extends?: string[] },
  byKey: Map<string, ConfigDagNode>,
): { key: string; owners: string[] }[] {
  const ownersByField = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const stack = [...getConfigBaseKeys(leaf)];
  while (stack.length) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = byKey.get(key);
    if (!c) continue;
    for (const f of c.schema?.fields ?? []) {
      let set = ownersByField.get(f.key);
      if (!set) {
        set = new Set<string>();
        ownersByField.set(f.key, set);
      }
      set.add(c.key);
    }
    for (const b of getConfigBaseKeys(c)) stack.push(b);
  }
  const conflicts: { key: string; owners: string[] }[] = [];
  for (const [field, owners] of ownersByField) {
    // A single owner reached via multiple paths (diamond) is fine; 2+ distinct
    // owners means divergent sibling branches both declare the field.
    if (owners.size >= 2) {
      conflicts.push({ key: field, owners: [...owners].sort() });
    }
  }
  return conflicts;
}

// Own value keys whose stored value no longer conforms to the effective
// (inherited) field type — the "incompatible, must fix" state that arises when
// an ancestor's schema change leaves a descendant's preserved value mismatched.
// Reference-backed values are exempt (resolved type is unknown). Returns the
// list of offending own keys (empty = all conform).
export function findIncompatibleConfigValueKeys({
  value,
  fields,
}: {
  value: Record<string, unknown>;
  fields: SchemaField[];
}): string[] {
  // Single-compile scan (see collectInvalidConfigValueKeys): compiling the schema
  // once per call instead of once per value key keeps the per-node lineage scan
  // from quadratically recompiling Ajv across a family.
  //
  // Force `additionalProperties: true`: this scan reports values whose *type* no
  // longer conforms, not extensibility violations (extra/unknown keys) — those
  // are enforced separately by validateConfigValue at write time.
  return collectInvalidConfigValueKeys({
    value,
    fields,
    additionalProperties: true,
  });
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

// Effective extensibility for a config family. Only the spine root (the topmost
// `parent` ancestor — see getConfigSpineRootKey) config's explicit `extensible`
// checkbox matters; when absent it inherits the org default
// (`configsExtensibleByDefault`), which itself defaults to permissive (true).
// Mixin (`extends`) bases' extensibility is intentionally ignored under
// composition. An extensible family permits child configs / feature rules /
// overrides to add keys beyond the declared schema.
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

  // Values merge base → leaf with deep (targeted) patching: a descendant
  // restates only the leaves it changes and inherits the rest. `source` tracks
  // the deepest node that touched the top-level key (nested provenance is a
  // future concern). `$extends` chunks stay atomic (see deepMergePatch).
  const valueByKey = new Map<string, { value: unknown; source: string }>();
  for (const node of chain) {
    const obj = parsePlainJSONObject(node.value ?? "") ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === CONSTANT_EXTENDS_KEY) continue;
      const prev = valueByKey.get(k);
      valueByKey.set(k, {
        value: prev ? deepMergePatch(prev.value, v) : v,
        source: node.key,
      });
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

// Every invariant that fails against `leafKey`'s resolved (inherited + own)
// value. Rules accumulate base → leaf (leaf wins on name) — the same set that
// gates the config's own publish. Skips value resolution when the chain
// declares no rules, so invariant-free families stay cheap.
export function collectConfigInvariantViolations(
  leafKey: string,
  byKey: Map<string, ConfigDagNode>,
): InvariantViolation[] {
  const chain = linearizeConfigDag(leafKey, byKey);
  type Invariant = NonNullable<SimpleSchema["invariants"]>[number];
  const invByName = new Map<string, Invariant>();
  for (const node of chain) {
    for (const inv of node.schema?.invariants ?? []) {
      invByName.set(inv.name, inv);
    }
  }
  if (!invByName.size) return [];
  const resolvedValue: Record<string, unknown> = {};
  for (const f of resolveConfigChain(chain).fields) {
    if (f.source !== null) resolvedValue[f.key] = f.value;
  }
  return evaluateInvariants(resolvedValue, [...invByName.values()]);
}

// Descendants of `rootKey` (every base edge — parent + extends, transitively)
// whose effective invariants fail against their resolved value. Substitute a
// proposed root into `byKey` to preview a publish's effect on the family.
export function collectDescendantInvariantViolations(
  rootKey: string,
  byKey: Map<string, ConfigDagNode>,
): {
  configKey: string;
  configName?: string;
  violations: InvariantViolation[];
}[] {
  return getConfigSubtree(rootKey, [...byKey.values()])
    .filter((key) => key !== rootKey)
    .map((key) => ({
      configKey: key,
      configName: byKey.get(key)?.name,
      violations: collectConfigInvariantViolations(key, byKey),
    }))
    .filter((d) => d.violations.length > 0);
}
