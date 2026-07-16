import { SimpleSchema, SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../constants";
import { parsePlainJSONObject } from "./features";
import {
  collectInvalidConfigValueKeys,
  evaluateInvariants,
  fieldsContractEqual,
  invariantRuleFields,
  InvariantViolation,
  SchemaWarning,
  validateConfigValue,
  valueHasReferenceToken,
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

// Whether a config is an environment/project "flavor" — a variant selected by
// some parent's scopedOverrides. Reads the self-describing `scopedConfig` marker
// (stamped when the parent's scopedOverrides is written), so callers can filter
// flavors out of list views / feature `baseConfig` selectors / the lineage tree
// without reverse-scanning every config. Typed structurally to stay validator-
// import-free (shared by FE + BE).
export function isScopedConfig(config: {
  scopedConfig?: { parent: string } | null;
}): boolean {
  return (config.scopedConfig ?? null) !== null;
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
  const list = obj[CONSTANT_EXTENDS_KEY];
  // Only an array `$extends` is a config-backing directive that could hold
  // `@config:` refs. A non-array value under this key isn't ours to interpret,
  // so leave the whole value intact rather than dropping the key.
  if (!Array.isArray(list)) return value;
  const rest = { ...obj };
  const kept = list.filter(
    (r) => !(typeof r === "string" && r.startsWith("@config:")),
  );
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

// Whether a value string carries ANY `@config:` `$extends` ref (not just the
// first). The REST layer uses this to reject raw config directives — config
// backing must come through dedicated fields, never inline `$extends`.
export function valueHasConfigExtends(value: string | undefined): boolean {
  const list = parsePlainJSONObject(value ?? "")?.[CONSTANT_EXTENDS_KEY];
  return (
    Array.isArray(list) &&
    list.some((r) => typeof r === "string" && r.startsWith("@config:"))
  );
}

// The config backing a feature, if any. `baseConfig` is the SOLE, authoritative
// source of config-backing ("Config mode") — a value's own `@config:` `$extends`
// is never treated as backing the feature (the payload compiler strips such
// stray refs for non-config flags). Only applies to JSON flags. This is the
// canonical "is this feature config-backed?" check across FE, API, and compiler.
export function getFeatureBaseConfigKey(feature: {
  valueType: string;
  baseConfig?: string | null;
}): string | null {
  if (feature.valueType !== "json") return null;
  return feature.baseConfig ?? null;
}

// Compose a config key + an override patch into the stored value string. The
// config ref is the first `$extends` entry (the base layer); any `@const:` refs
// in the patch are preserved after it. With no config key, returns the patch
// with its `@config:` ref stripped. A non-empty, non-object patch (e.g. `true`)
// is returned verbatim — attaching or detaching — so plain values aren't
// silently discarded and downstream validation sees the caller's value.
export function setConfigBacking(
  configKey: string | null,
  patch: string | undefined,
): string {
  const obj = parsePlainJSONObject(patch ?? "");
  if (!obj) {
    if (!configKey || (patch ?? "").trim()) return patch ?? "";
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

// Order configs for display in a picker: `parent`-spine roots alphabetically by
// name, each followed (depth-first) by its children alphabetically, so lineage
// reads top-down. `depth` is the spine depth WITHIN the supplied set — a config
// whose parent isn't in the set is a root (depth 0). Cycle-safe; any config not
// reached is appended alphabetically. Mixins (`extends`) don't affect ordering.
//
// `preserveRootOrder` keeps the roots in the order they arrive (rather than
// sorting them by name), so a caller that already sorted the input by some
// key/direction can keep that ordering for the top level while children stay
// grouped under each parent in their own fixed (name) order.
const configNameCollator = new Intl.Collator();

export function orderConfigsByLineage<
  T extends { key: string; name?: string; parent?: string },
>(
  configs: T[],
  opts?: { preserveRootOrder?: boolean },
): { config: T; depth: number }[] {
  const byKey = new Map(configs.map((c) => [c.key, c]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const c of configs) {
    const parent = getConfigParentKey(c);
    if (parent && byKey.has(parent)) {
      const list = childrenOf.get(parent);
      if (list) list.push(c);
      else childrenOf.set(parent, [c]);
    } else {
      roots.push(c);
    }
  }
  const byName = (a: T, b: T) =>
    configNameCollator.compare(a.name ?? a.key, b.name ?? b.key);
  const out: { config: T; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (c: T, depth: number) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    out.push({ config: c, depth });
    for (const kid of (childrenOf.get(c.key) ?? []).slice().sort(byName)) {
      visit(kid, depth + 1);
    }
  };
  const rootOrder = opts?.preserveRootOrder
    ? roots
    : roots.slice().sort(byName);
  for (const root of rootOrder) visit(root, 0);
  // Recover any configs left unreached by a parent cycle (never happens in a
  // valid DAG — cycles are rejected at write time). Guarded so the common case
  // doesn't pay for a second pass.
  if (seen.size < configs.length) {
    const rest = opts?.preserveRootOrder
      ? configs
      : configs.slice().sort(byName);
    for (const c of rest) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        out.push({ config: c, depth: 0 });
      }
    }
  }
  return out;
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
    extendsKeys?: string[];
  }[],
  configKey: string,
  ownSchemaKeys: string[],
): { name: string; keys: string[] }[] {
  if (!ownSchemaKeys.length) return [];
  const byKey = new Map(lineage.map((n) => [n.key, n]));
  const ownKeys = new Set(ownSchemaKeys);
  // Match the server cascade (reconcileConfigDescendants), which reconciles via
  // ANY base edge — walk the full subtree (parent spine + `extends` mixins), not
  // the spine alone, so a mixin descendant's redundant field is previewed too.
  // The walk self-restricts to descendants of `configKey`, so extra nodes (e.g.
  // a composing family's own ancestors) can't produce false positives.
  const descendants = getConfigSubtree(
    configKey,
    lineage.map((n) => ({
      key: n.key,
      parent: n.parentKey ?? undefined,
      extends: n.extendsKeys,
    })),
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

// Base entries (parent first, then `extends` in order) where a LATER entry is
// a transitive ancestor of an EARLIER one. linearizeConfigDag emits bases
// before their dependents while the SDK payload applies `$extends` layers in
// literal order, so such a list makes the two disagree on precedence — reject
// it at write time. An EARLIER entry that's an ancestor of a later one (the
// diamond pattern) orders identically in both and stays allowed.
export function findBasePrecedenceInversions(
  config: { parent?: string; extends?: string[] },
  byKey: Map<string, { parent?: string; extends?: string[] }>,
): { earlier: string; ancestor: string }[] {
  const bases = getConfigBaseKeys(config);
  const out: { earlier: string; ancestor: string }[] = [];
  for (let i = 0; i < bases.length; i++) {
    const node = byKey.get(bases[i]);
    if (!node) continue;
    const ancestors = getConfigAncestorKeys(node, byKey);
    for (let j = i + 1; j < bases.length; j++) {
      if (ancestors.has(bases[j])) {
        out.push({ earlier: bases[i], ancestor: bases[j] });
      }
    }
  }
  return out;
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
    { parent?: string; extends?: string[]; schema?: SimpleSchema | null }
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

// Field key → the closest ancestor that declares it, with that declaration.
// BFS over the base DAG (parent/mixin precedence order within a level) so the
// closest base wins a transient duplicate; at rest exactly one ancestor owns a
// key (sibling conflicts are hard errors, child re-declarations are stripped).
// Cycle-safe; dangling base keys are skipped (same tolerance as
// getAncestorSchemaKeys).
export function getAncestorSchemaFieldOwners(
  config: { parent?: string; extends?: string[] },
  byKey: Map<
    string,
    { parent?: string; extends?: string[]; schema?: SimpleSchema | null }
  >,
): Map<string, { owner: string; field: SchemaField }> {
  const owners = new Map<string, { owner: string; field: SchemaField }>();
  const seen = new Set<string>();
  const queue = [...getConfigBaseKeys(config)];
  while (queue.length) {
    const baseKey = queue.shift() as string;
    if (seen.has(baseKey)) continue;
    seen.add(baseKey);
    const base = byKey.get(baseKey);
    if (!base) continue;
    for (const f of base.schema?.fields ?? []) {
      if (!owners.has(f.key)) owners.set(f.key, { owner: baseKey, field: f });
    }
    for (const b of getConfigBaseKeys(base)) queue.push(b);
  }
  return owners;
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
      // Preserve any pre-selected env/project flavor patch so callers can
      // validate the per-environment resolved value (base ⊕ flavor ⊕ …), not
      // just the env-agnostic base. Absent = no variant for this node/context.
      variantPatch: node.variantPatch,
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

// Own top-level value keys the effective schema no longer declares — what an
// ancestor's field removal leaves behind. They still resolve and are served,
// but nothing validates them and rules read them as null (and a non-extensible
// family rejects them on the next changing publish). Empty when the effective
// schema declares no fields at all: a value-first, schema-less family isn't
// "orphaned". Reference-backed values are NOT exempt (orphanhood is about
// declaration, not type — cf. findIncompatibleConfigValueKeys).
export function findOrphanedConfigValueKeys({
  value,
  fields,
}: {
  value: Record<string, unknown>;
  fields: SchemaField[];
}): string[] {
  if (!fields.length) return [];
  const declared = new Set(fields.map((f) => f.key));
  return Object.keys(value).filter(
    (k) => k !== CONSTANT_EXTENDS_KEY && !declared.has(k),
  );
}

// Remove schema fields whose key is owned by an ancestor (base wins). Returns
// the reconciled field list, or null when nothing changes (no collisions).
export function stripAncestorOwnedFields(
  schema: SimpleSchema | null | undefined,
  ancestorKeys: Set<string>,
): SchemaField[] | null {
  const fields = schema?.fields ?? [];
  if (!fields.length || !ancestorKeys.size) return null;
  const kept = fields.filter((f) => !ancestorKeys.has(f.key));
  return kept.length === fields.length ? null : kept;
}

export type AncestorFieldCollision = { key: string; owner: string };

// Split a schema's re-declarations of ancestor-owned fields by whether the
// child's definition matches the owner's contract (description differences
// don't count — the ancestor's wins anyway). `kept` mirrors
// stripAncestorOwnedFields: the field list with every collision removed, or
// null when there are none. Policy (reject vs warn) is the caller's.
export function classifyAncestorOwnedFields(
  schema: SimpleSchema | null | undefined,
  owners: Map<string, { owner: string; field: SchemaField }>,
): {
  kept: SchemaField[] | null;
  identical: AncestorFieldCollision[];
  conflicting: AncestorFieldCollision[];
} {
  const fields = schema?.fields ?? [];
  const identical: AncestorFieldCollision[] = [];
  const conflicting: AncestorFieldCollision[] = [];
  if (!fields.length || !owners.size) {
    return { kept: null, identical, conflicting };
  }
  const kept: SchemaField[] = [];
  for (const f of fields) {
    const owned = owners.get(f.key);
    if (!owned) {
      kept.push(f);
    } else if (fieldsContractEqual(f, owned.field)) {
      identical.push({ key: f.key, owner: owned.owner });
    } else {
      conflicting.push({ key: f.key, owner: owned.owner });
    }
  }
  return {
    kept: kept.length === fields.length ? null : kept,
    identical,
    conflicting,
  };
}

export function formatAncestorFieldConflictMessage(
  conflicting: AncestorFieldCollision[],
): string {
  const detail = conflicting
    .map((c) => `"${c.key}" (owned by "${c.owner}")`)
    .join(", ");
  return (
    `This schema re-declares field(s) an ancestor config already defines, ` +
    `with a different definition: ${detail}. A descendant may override a ` +
    `field's value but not its schema — remove the re-declaration or make ` +
    `it identical to the ancestor's definition.`
  );
}

export function ancestorCollisionWarnings(
  identical: AncestorFieldCollision[],
): SchemaWarning[] {
  return identical.map((c) => ({
    code: "redundant-declaration",
    path: c.key,
    message:
      `Field "${c.key}" re-declares ancestor config "${c.owner}"'s ` +
      `definition and was removed — the ancestor owns the field's schema ` +
      `("base wins"); this config still inherits it.`,
  }));
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
  // `null` = explicitly no schema (a cleared config), read identically to absent.
  schema?: SimpleSchema | null;
  // The scope-selected flavor's own patch for the target environment/project,
  // already chosen by the caller (see selectScopedOverride), deep-merged on top of
  // this node's own value. Absent = no variant applies for this node + context.
  variantPatch?: string;
};

// Flavor selection lives in a leaf module (cycle-safe; see scoped-overrides.ts);
// re-exported here so config callers can keep importing it from util/configs.
export {
  selectScopedOverride,
  findScopedOverrideStructuralErrors,
  type ScopedOverrideEntry,
} from "./scoped-overrides";

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
  const applyOwnKeys = (obj: Record<string, unknown>, source: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === CONSTANT_EXTENDS_KEY) continue;
      const prev = valueByKey.get(k);
      valueByKey.set(k, {
        value: prev ? deepMergePatch(prev.value, v) : v,
        source,
      });
    }
  };
  for (const node of chain) {
    applyOwnKeys(parsePlainJSONObject(node.value ?? "") ?? {}, node.key);
    // The scope-selected flavor patch is this node's own top layer, applied after
    // its base value so a descendant node still wins over an ancestor's variant.
    if (node.variantPatch) {
      applyOwnKeys(parsePlainJSONObject(node.variantPatch) ?? {}, node.key);
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

// Whether any node in a chain declares a `@const:`/`@config:` `$extends`
// layer — in its own value or its scope-selected flavor patch (variantPatch).
// Such a layer can supply arbitrary fields but is unresolvable at gate time, so
// required-field enforcement treats it as satisfying everything (the analog of
// the reference-backed own-key exemption).
export function configChainDeclaresReferenceLayer(
  chain: ConfigChainNode[],
): boolean {
  const declaresRef = (value: string | undefined): boolean => {
    const list = parsePlainJSONObject(value ?? "")?.[CONSTANT_EXTENDS_KEY];
    return (
      Array.isArray(list) &&
      list.some((r) => typeof r === "string" && /^@(?:const|config):/.test(r))
    );
  };
  return chain.some(
    (node) => declaresRef(node.value) || declaresRef(node.variantPatch),
  );
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
  // Skip a rule we can't fairly evaluate at gate time, per field it references:
  //  - reference-backed keys hold raw `@const:`/`{{ @const:... }}` tokens here,
  //    not their resolved values, so a rule would compare against the token; and
  //  - when the chain declares a `@const:`/`@config:` `$extends` layer, a field
  //    ABSENT from the resolved value may be supplied by that (gate-time-
  //    unresolvable) layer, so a rule over it can't be judged.
  // A rule over concretely-resolved fields still evaluates — a reference layer
  // elsewhere in the chain no longer exempts the whole config.
  const hasRefLayer = configChainDeclaresReferenceLayer(chain);
  const refBackedKeys = new Set(
    Object.keys(resolvedValue).filter((k) =>
      valueHasReferenceToken(resolvedValue[k]),
    ),
  );
  const unevaluableField = (k: string): boolean =>
    refBackedKeys.has(k) || (hasRefLayer && !(k in resolvedValue));
  const evaluable = [...invByName.values()].filter(
    (inv) => !invariantRuleFields(inv.rule).some(unevaluableField),
  );
  if (!evaluable.length) return [];
  return evaluateInvariants(resolvedValue, evaluable);
}

// Validate a config's FULLY-RESOLVED, concrete value (an object with all
// `@const:`/`@config:` references already substituted — no tokens left) against
// its effective schema and effective (lineage-accumulated, leaf-wins) invariants.
// Returns human-readable violation messages.
//
// This is the check the ordinary config-publish collectors can't do: they
// deliberately EXEMPT reference-backed fields (which hold raw tokens at gate
// time). The schema-break guard resolves the reference first, then hands the
// concrete value here — so a constant change that makes a dependent config's
// resolved value type-invalid or invariant-violating is finally caught. `value`
// must already be constant-substituted by the caller.
export function collectResolvedConfigValueViolations({
  configKey,
  value,
  byKey,
  additionalProperties,
}: {
  configKey: string;
  value: Record<string, unknown>;
  byKey: Map<string, ConfigDagNode>;
  additionalProperties: boolean;
}): string[] {
  const chain = linearizeConfigDag(configKey, byKey);
  const { effectiveSchema } = resolveConfigChain(chain);
  const errors: string[] = [];

  const res = validateConfigValue({
    value,
    fields: effectiveSchema,
    additionalProperties,
  });
  if (!res.valid) errors.push(...res.errors);

  // Effective invariants: base → leaf, leaf wins on name (same accumulation as
  // collectConfigInvariantViolations), evaluated against the concrete value.
  const invByName = new Map<
    string,
    NonNullable<SimpleSchema["invariants"]>[number]
  >();
  for (const node of chain) {
    for (const inv of node.schema?.invariants ?? [])
      invByName.set(inv.name, inv);
  }
  for (const vi of evaluateInvariants(value, [...invByName.values()])) {
    errors.push(vi.message);
  }
  return errors;
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

export type ConfigFamilyMember = {
  key: string;
  name?: string;
  parent?: string;
  extends?: string[];
  value?: string;
  schema?: SimpleSchema | null;
  archived?: boolean;
};

export type ConfigSchemaChangeImpact = {
  configKey: string;
  configName?: string;
  // Own value keys the change un-declares (overrides orphaned by a removal).
  orphanedKeys: string[];
  // Own value keys that stop conforming to the effective schema (retype/narrow).
  newlyIncompatibleKeys: string[];
  // Own schema fields the change newly ancestor-owns with a DIFFERING contract
  // — the cascade would drop the member's definition, losing its intent.
  // (Contract-identical strips are lossless and deliberately not reported.)
  conflictingStripKeys: string[];
  // Own rules referencing fields the change removes (they'd read null).
  invariantRefs: { name: string; keys: string[] }[];
};

// What a proposed root schema/lineage change does to the rest of the family
// (`after` = `before` with the proposed root substituted). Per member, in BFS
// order, root excluded; members with no impact are omitted, so an additive or
// contract-identical change returns []. Archived members are included — their
// values still resolve (consistent with collectDescendantInvariantViolations).
export function computeConfigSchemaChangeImpact({
  rootKey,
  before,
  after,
}: {
  rootKey: string;
  before: ConfigFamilyMember[];
  after: ConfigFamilyMember[];
}): ConfigSchemaChangeImpact[] {
  const beforeByKey = new Map(before.map((c) => [c.key, c]));
  const afterByKey = new Map(after.map((c) => [c.key, c]));

  // Union of both subtrees, defensively: the proposed change only rewrites the
  // root's own node, but membership math is cheap and this stays correct if a
  // caller ever substitutes more than the root.
  const memberKeys: string[] = [];
  const seen = new Set<string>([rootKey]);
  for (const key of [
    ...getConfigSubtree(rootKey, before),
    ...getConfigSubtree(rootKey, after),
  ]) {
    if (seen.has(key)) continue;
    seen.add(key);
    memberKeys.push(key);
  }

  const impacts: ConfigSchemaChangeImpact[] = [];
  for (const key of memberKeys) {
    const member = afterByKey.get(key) ?? beforeByKey.get(key);
    if (!member) continue;

    const effBefore = resolveConfigChain(
      linearizeConfigDag(key, beforeByKey),
    ).effectiveSchema;
    // First-seen-wins resolution already models the post-cascade family: a
    // member's own re-declaration of a root-owned key doesn't contribute here.
    const effAfter = resolveConfigChain(
      linearizeConfigDag(key, afterByKey),
    ).effectiveSchema;
    const declaredBefore = new Set(effBefore.map((f) => f.key));
    const declaredAfter = new Set(effAfter.map((f) => f.key));
    const removedKeys = [...declaredBefore].filter(
      (k) => !declaredAfter.has(k),
    );

    const ownValue = parsePlainJSONObject(member.value ?? "") ?? {};
    const ownKeys = Object.keys(ownValue).filter(
      (k) => k !== CONSTANT_EXTENDS_KEY,
    );

    // A schema-less family is un-orphanable (findOrphanedConfigValueKeys
    // returns [] for it), so removing the entire schema orphans nothing here
    // either — preview and at-rest must agree.
    const orphanedKeys = effAfter.length
      ? ownKeys.filter((k) => declaredBefore.has(k) && !declaredAfter.has(k))
      : [];

    const incompatibleBefore = new Set(
      ownKeys.length
        ? findIncompatibleConfigValueKeys({
            value: ownValue,
            fields: effBefore,
          })
        : [],
    );
    const newlyIncompatibleKeys = (
      ownKeys.length
        ? findIncompatibleConfigValueKeys({ value: ownValue, fields: effAfter })
        : []
    ).filter((k) => !incompatibleBefore.has(k));

    const conflictingBefore = new Set(
      classifyAncestorOwnedFields(
        member.schema,
        getAncestorSchemaFieldOwners(member, beforeByKey),
      ).conflicting.map((c) => c.key),
    );
    const conflictingStripKeys = classifyAncestorOwnedFields(
      member.schema,
      getAncestorSchemaFieldOwners(member, afterByKey),
    )
      .conflicting.map((c) => c.key)
      .filter((k) => !conflictingBefore.has(k));

    const removed = new Set(removedKeys);
    const invariantRefs = (member.schema?.invariants ?? [])
      .map((inv) => ({
        name: inv.name,
        keys: invariantRuleFields(inv.rule).filter((k) => removed.has(k)),
      }))
      .filter((r) => r.keys.length > 0);

    if (
      orphanedKeys.length ||
      newlyIncompatibleKeys.length ||
      conflictingStripKeys.length ||
      invariantRefs.length
    ) {
      impacts.push({
        configKey: key,
        configName: member.name,
        orphanedKeys,
        newlyIncompatibleKeys,
        conflictingStripKeys,
        invariantRefs,
      });
    }
  }
  return impacts;
}

// Rules whose referenced top-level fields aren't declared by the effective
// schema. A warning, never an error: extensible families accept undeclared
// keys, and a base's rule may reference a field only its descendants declare.
export function findUndeclaredInvariantRuleFields(
  invariants: { name: string; rule: string }[] | undefined,
  declaredKeys: Iterable<string>,
): { name: string; keys: string[] }[] {
  const declared = new Set(declaredKeys);
  return (invariants ?? [])
    .map((inv) => ({
      name: inv.name,
      keys: invariantRuleFields(inv.rule).filter((k) => !declared.has(k)),
    }))
    .filter((r) => r.keys.length > 0);
}

export function undeclaredRuleFieldWarnings(
  undeclared: { name: string; keys: string[] }[],
): SchemaWarning[] {
  return undeclared.map((u) => ({
    code: "undeclared-rule-field",
    path: u.keys[0],
    message:
      `Validation rule "${u.name}" references undeclared field(s) ` +
      `${u.keys.map((k) => `"${k}"`).join(", ")} — undeclared fields ` +
      `evaluate as null when the rule runs.`,
  }));
}
