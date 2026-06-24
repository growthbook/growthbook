import { SimpleSchema, SchemaField } from "shared/types/feature";
import { parsePlainJSONObject } from "./features";

// A single config in a lineage chain (base → … → leaf). `value` is the config's
// JSON-encoded object (own field values, possibly with an `$extends` parent
// ref); `schema` is the fields this config *appends* (the base owns inherited
// fields).
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
