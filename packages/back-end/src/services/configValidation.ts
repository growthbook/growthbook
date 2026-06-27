import {
  resolveConfigChain,
  linearizeConfigDag,
  getConfigSpineRootKey,
  configIsExtensible,
  parsePlainJSONObject,
  validateConfigValue,
  findIncompatibleConfigValueKeys,
} from "shared/util";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import { Context } from "back-end/src/models/BaseModel";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";

// The leaf config we're validating, with optional draft overrides for the
// schema / parent / extends so a draft edit is judged against the lineage it's
// also setting (not the stale live one).
type ConfigLeaf = Pick<ConfigInterface, "key" | "name" | "value"> & {
  schema?: SimpleSchema;
  parent?: string;
  extends?: string[];
  extensible?: boolean;
  environmentValues?: Record<string, string>;
};

// Resolve a config's effective schema fields + extensibility across its full
// base DAG (parent + every `extends` mixin) — the same accumulation
// `getConfigSchema` exposes via `?effective=true`. The leaf's own
// schema/parent/extends may be overridden to reflect a draft's proposed state.
export async function getEffectiveConfigSchema(
  context: Context,
  leaf: ConfigLeaf,
): Promise<{ fields: SchemaField[]; additionalProperties: boolean }> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  // Inject the draft leaf so its proposed schema/parent/extends drive the walk.
  byKey.set(leaf.key, { ...byKey.get(leaf.key), ...leaf } as ConfigInterface);
  const chain = linearizeConfigDag(leaf.key, byKey);
  // Extensibility is governed by the `parent`-spine root's checkbox; mixin
  // bases' extensibility is ignored under composition.
  const spineRoot = byKey.get(getConfigSpineRootKey(leaf.key, byKey));
  return {
    fields: resolveConfigChain(chain).effectiveSchema,
    additionalProperties: configIsExtensible(
      spineRoot,
      context.org.settings?.configsExtensibleByDefault,
    ),
  };
}

type ConfigValues = {
  value?: string;
  environmentValues?: Record<string, string>;
};

// Collect (don't throw) every schema-conformance error for a config's staged
// value(s) against its effective schema. Values are sparse (a child only sets
// the keys it overrides), so `required` is NOT enforced; type/extensibility
// conformance of present keys is.
async function collectConfigValueErrors(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<string[]> {
  const { fields, additionalProperties } = await getEffectiveConfigSchema(
    context,
    leaf,
  );
  const errors: string[] = [];
  const check = (raw: string | undefined, label: string) => {
    if (raw === undefined || raw === "") return;
    const obj = parsePlainJSONObject(raw);
    // Non-object / unparseable values are caught upstream by
    // validateResolvableValue; nothing to schema-check here.
    if (!obj) return;
    const res = validateConfigValue({
      value: obj,
      fields,
      additionalProperties,
    });
    if (!res.valid) errors.push(`${label}: ${res.errors.join(", ")}`);
  };
  check(values.value, "value");
  for (const [env, v] of Object.entries(values.environmentValues ?? {})) {
    check(v, `environmentValues.${env}`);
  }
  return errors;
}

// Enforce that a config's staged value(s) conform to its effective schema —
// the config analog of `assertFeatureValuesValid`. Block-vs-warn is governed by
// the org's `blockPublishOnSchemaError` (default true = block): when false,
// writes are never blocked here (the mismatch is surfaced as `incompatibleFields`
// on reads instead). Opt out per-request with ?skipSchemaValidation=true.
export async function assertConfigValueValid(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  // Warn-only mode: never block a write; the editor + REST surface the issue.
  if (context.org.settings?.blockPublishOnSchemaError === false) return;
  const errors = await collectConfigValueErrors(context, leaf, values);
  if (errors.length) throw new BadRequestError(errors.join("; "));
}

// The config's own value keys that no longer conform to its effective
// (inherited) schema — the "incompatible, must fix" state. Surfaced on reads
// (REST + editor) and flagged in the lineage; never blocks serving the value.
export async function getIncompatibleConfigFields(
  context: Context,
  leaf: ConfigLeaf,
): Promise<string[]> {
  const { fields, additionalProperties } = await getEffectiveConfigSchema(
    context,
    leaf,
  );
  // Union over the default value AND every environment override — a stale prod
  // value must surface even when the default conforms.
  const incompatible = new Set<string>();
  for (const raw of [
    leaf.value,
    ...Object.values(leaf.environmentValues ?? {}),
  ]) {
    const obj = parsePlainJSONObject(raw ?? "");
    if (!obj) continue;
    for (const k of findIncompatibleConfigValueKeys({
      value: obj,
      fields,
      additionalProperties,
    })) {
      incompatible.add(k);
    }
  }
  return [...incompatible];
}

// Required fields can only be enforced against a fully-resolved value — sparse
// own values rely on inheritance to fill the rest. This resolves the leaf's
// default value across its base DAG (own value merged onto inherited base
// values) and reports required fields that remain unset and have no schema
// default. Env overrides inherit from the resolved default, so checking the
// default alone is sufficient. Reference-backed keys count as set.
async function collectMissingRequiredFields(
  context: Context,
  leaf: ConfigLeaf,
  rawValue: string | undefined,
): Promise<string[]> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map<string, ConfigInterface>(all.map((c) => [c.key, c]));
  byKey.set(leaf.key, {
    ...byKey.get(leaf.key),
    ...leaf,
    // Resolve against the staged value, not the stored one.
    value: rawValue ?? leaf.value,
  } as ConfigInterface);
  const chain = linearizeConfigDag(leaf.key, byKey);
  const { effectiveSchema, fields } = resolveConfigChain(chain);
  const resolvedKeys = new Set(
    fields.filter((f) => f.source !== null).map((f) => f.key),
  );
  const missing = effectiveSchema
    .filter((f) => f.required && f.default === "" && !resolvedKeys.has(f.key))
    .map((f) => f.key);
  if (!missing.length) return [];
  return [
    `value: missing required field(s) ${missing
      .map((k) => `"${k}"`)
      .join(", ")}`,
  ];
}

// Publish-time safety net for configs (the analog of
// `assertFeatureValuesValidForPublish`). When the org's
// `blockPublishOnSchemaError` is true (default) a mismatch blocks the publish;
// when false it's a bypassable soft warning. Unlike the per-write check, publish
// also enforces required fields against the fully-resolved value.
export async function assertConfigValueValidForPublish(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  const errors = [
    ...(await collectConfigValueErrors(context, leaf, values)),
    ...(await collectMissingRequiredFields(context, leaf, values.value)),
  ];
  if (!errors.length) return;
  // Default to blocking when the setting is absent.
  if (context.org.settings?.blockPublishOnSchemaError === false) {
    // Warn mode: a bypassable soft warning (?ignoreWarnings=true), consistent
    // with the rest of the publish flow.
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Publishing config value(s) that don't match the schema:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join("; "));
}
