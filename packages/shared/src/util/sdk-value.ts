import { FeatureValueType } from "shared/types/feature";
import { getJSONValue } from "../sdk-versioning/sdk-payload";
import {
  ensureConfigBacking,
  getFeatureBaseConfigKey,
  stripConfigExtends,
} from "./configs";
import { deepMergePatch } from "./deep-merge";
import { parsePlainJSONObject } from "./features";

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// How a feature's values reach the SDK payload, shared by the payload and the
// pages that predict it. `serve` takes a stored value and returns what the SDK
// receives: config backing applied (or a stray `@config:` dropped), a sparse
// patch merged onto the resolved default, and references resolved by
// `resolveRefs` when given.
export function sdkValueResolver({
  valueType,
  baseConfig,
  defaultValue,
  resolveRefs,
}: {
  valueType: FeatureValueType;
  baseConfig?: string | null;
  defaultValue: string;
  resolveRefs?: (value: unknown) => unknown;
}): {
  // A config-backed feature's rule values are always patches on its default.
  configBacked: boolean;
  serve: (value: string, sparse?: boolean) => unknown;
} {
  const resolve = resolveRefs ?? ((value: unknown) => value);
  // Config-backing is authoritative via `baseConfig`. For a config-backed
  // feature, every value implicitly serves the base config: if a value doesn't
  // reference its own (family) config, the feature's is prepended so resolution
  // flattens the base underneath it. A non-config feature's value must not
  // carry `@config:` at all, so any stray ref is stripped (`@const:` refs stay).
  const configKey = getFeatureBaseConfigKey({ valueType, baseConfig });

  // The sparse merge base: the default, with its references resolved. Null
  // when it isn't a plain key/value object, which makes sparse a no-op.
  const jsonDefault = (() => {
    if (valueType !== "json") return null;
    const backed = configKey
      ? ensureConfigBacking(defaultValue, configKey)
      : (stripConfigExtends(defaultValue) ?? defaultValue);
    const base = parsePlainJSONObject(backed);
    if (!base || !resolveRefs) return base;
    return plainObject(resolve(base)) ?? base;
  })();

  const serve = (value: string, sparse?: boolean): unknown => {
    // Non-object values (array/scalar/string) have replace semantics: shipped
    // as-is rather than under a config base they'd never merge with.
    const normalized = configKey
      ? value.trim() === "" || parsePlainJSONObject(value) !== null
        ? ensureConfigBacking(value, configKey)
        : value
      : (stripConfigExtends(value) ?? value);
    if (sparse && jsonDefault) {
      const patch = parsePlainJSONObject(normalized);
      if (patch !== null) {
        // The patch resolves before merging, so its fields win over the
        // already-resolved default. A config-backed value keeps its own
        // `$extends`, resolving against the config it references. A patch that
        // resolves to a non-object replaces outright.
        const resolvedPatch = resolve(patch);
        const patchObject = plainObject(resolvedPatch);
        if (!patchObject) return resolvedPatch;
        // Config-backed features patch deep, restating only the leaves a value
        // changes; plain JSON features spread at the top level.
        return configKey
          ? deepMergePatch(jsonDefault, patchObject)
          : { ...jsonDefault, ...patchObject };
      }
    }
    return resolve(getJSONValue(valueType, normalized));
  };

  return { configBacked: !!configKey, serve };
}
