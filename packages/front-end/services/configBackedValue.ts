import { ConstantInterface } from "shared/types/constant";
import {
  deepMergePatch,
  getConfigBackingPatch,
  setConfigBacking,
} from "shared/util";
import {
  buildConstantValueMap,
  ConstantSource,
  resolveConstantRefs,
} from "shared/sdk-versioning";

// Value-map inputs from the config "resolved" endpoint (constants + configs,
// each tagged with its namespace source).
export type ResolvableInput = Pick<
  ConstantInterface,
  "key" | "type" | "value" | "project" | "archived"
> & {
  source: ConstantSource;
  // A config's env/project flavor selection, so the resolver can swap in the
  // matching flavor for the environment being previewed.
  scopedOverrides?: {
    config: string;
    environments?: string[];
    projects?: string[];
  }[];
};

function toObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

// A config-backed value as the SDK receives it: the config, with its
// constants resolved, and the value's own patch merged onto it.
export function resolveConfigBackedValue({
  inputs,
  configKey,
  value,
  project,
  environment,
}: {
  inputs: ResolvableInput[];
  configKey: string;
  value: string;
  project: string;
  // Its env flavor (scopedOverrides) applies; absent is the base value.
  environment?: string;
}): Record<string, unknown> {
  // Keep undefined undefined: the resolver's env-agnostic mode (base only, no
  // flavors) is the all-environments contract — coercing to "" would apply
  // wildcard/project-only overrides in the all-envs view.
  const map = buildConstantValueMap(inputs, environment ?? "");
  const base = resolveConstantRefs(
    JSON.parse(setConfigBacking(configKey, "{}")),
    map,
    undefined,
    undefined,
    project,
    environment,
  );
  let patch: Record<string, unknown> = {};
  try {
    patch = (JSON.parse(getConfigBackingPatch(value)) ?? {}) as Record<
      string,
      unknown
    >;
  } catch {
    patch = {};
  }
  // The patch's own `@const:` refs resolve too, so it matches what the SDK
  // ships (the config base above is already resolved).
  const resolvedPatch =
    toObject(
      resolveConstantRefs(
        patch,
        map,
        undefined,
        undefined,
        project,
        environment,
      ),
    ) ?? patch;
  // Deep (targeted) patch onto the resolved base, as the SDK resolves it: the
  // patch restates only the leaves it changes.
  return deepMergePatch(toObject(base), resolvedPatch) as Record<
    string,
    unknown
  >;
}
