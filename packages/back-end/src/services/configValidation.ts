import {
  ConfigChainNode,
  resolveConfigChain,
  getConfigParentKey,
  configIsExtensible,
  parsePlainJSONObject,
  validateConfigValue,
} from "shared/util";
import { SchemaField, SimpleSchema } from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import { Context } from "back-end/src/models/BaseModel";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";

// The leaf config we're validating, with optional draft overrides for the
// schema / parent so a draft edit is judged against the schema it's also
// setting (not the stale live one).
type ConfigLeaf = Pick<ConfigInterface, "key" | "name" | "value"> & {
  schema?: SimpleSchema;
  parent?: string;
  extensible?: boolean;
};

// Walk a config's lineage (leaf → base) and resolve the family's effective
// schema fields + extensibility — the same accumulation `getConfigSchema`
// exposes via `?effective=true`. The leaf's own schema/parent may be overridden
// to reflect a draft's proposed state.
export async function getEffectiveConfigSchema(
  context: Context,
  leaf: ConfigLeaf,
): Promise<{ fields: SchemaField[]; additionalProperties: boolean }> {
  const chain: ConfigChainNode[] = [];
  const visited = new Set<string>();
  let cur: ConfigLeaf | ConfigInterface | null = leaf;
  let root: { extensible?: boolean } = leaf;
  while (cur && !visited.has(cur.key)) {
    visited.add(cur.key);
    root = cur;
    chain.unshift({
      key: cur.key,
      name: cur.name,
      value: cur.value,
      schema: cur.schema,
    });
    const parentKey: string | null = cur.parent || getConfigParentKey(cur);
    cur = parentKey
      ? ((await context.models.configs.getByKey(
          parentKey,
        )) as ConfigInterface | null)
      : null;
  }
  return {
    fields: resolveConfigChain(chain).effectiveSchema,
    additionalProperties: configIsExtensible(
      root,
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
// the config analog of `assertFeatureValuesValid`. Opt out with
// ?skipSchemaValidation=true.
export async function assertConfigValueValid(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  const errors = await collectConfigValueErrors(context, leaf, values);
  if (errors.length) throw new BadRequestError(errors.join("; "));
}

// Publish-time safety net for configs (the analog of
// `assertFeatureValuesValidForPublish`). When the org's
// `blockPublishOnSchemaError` is true (default) a mismatch blocks the publish;
// when false it's a bypassable soft warning.
export async function assertConfigValueValidForPublish(
  context: Context,
  leaf: ConfigLeaf,
  values: ConfigValues,
): Promise<void> {
  if (context.skipSchemaValidation) return;
  const errors = await collectConfigValueErrors(context, leaf, values);
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
