import { FeatureInterface, SchemaField } from "shared/types/feature";
import { ConstantInterface } from "shared/types/constant";
import {
  getConfigAncestorKeys,
  getConfigBackingPatch,
  setConfigBacking,
  validateJSONFeatureValue,
  deepMergePatch,
  selectScopedOverride,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantSource,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import { isEqual } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import ValueDisplay from "./ValueDisplay";

// Shared "SERVE ConfigName" header. The name links to the config detail page;
// the internal `@config:` directive is never surfaced.
function ServeConfigHeader({
  configKey,
  name,
  suffix,
}: {
  configKey: string;
  name: string;
  suffix?: string;
}) {
  return (
    <Flex direction="row" gap="4" align="center">
      <Text weight="medium">SERVE</Text>
      <Flex as="span" align="center" gap="1">
        <Link href={`/configs/${configKey}`} target="_blank" rel="noreferrer">
          {name}
        </Link>
        {suffix && <Text size="small">{suffix}</Text>}
      </Flex>
    </Flex>
  );
}

// Value-map inputs from the config "resolved" endpoint (constants + configs,
// each tagged with its namespace source).
type ResolvableInput = Pick<
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

// A config-backed value renders as "SERVE <icon> ConfigName" plus its resolved
// payload, never leaking the internal `@config:` directive.
//
// - Default value (`sparse` off): the fully-resolved config payload.
// - Rule (`sparse` on): the same payload, but as a diff against the feature
//   default — overridden fields bold, inherited base fields muted.
// A "with overrides" tag shows when the value carries its own patch fields on
// top of the config. Config + patch constants are all resolved so the preview
// matches the SDK payload.
export default function ConfigBackedSummary({
  value,
  configKey,
  feature,
  maxHeight,
  sparse = false,
  isDefault = false,
  environment,
}: {
  value: string;
  configKey: string;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
  // A config-backed default is a pure config (no overrides), so never tag it
  // "with overrides" — that suffix is for rules that layer their own patch.
  isDefault?: boolean;
  // The environment this value is being previewed for, so the config resolves
  // with its matching env flavor (scopedOverrides). Absent = the base value.
  environment?: string;
}) {
  const { configs } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const hasJsonValidator = hasCommercialFeature("json-validation");
  const config = configs.find((c) => c.key === configKey);

  const { data } = useApi<{
    constants: ResolvableInput[];
    effectiveSchema?: SchemaField[];
    extensible?: boolean;
  }>(`/configs/${configKey}/resolved`);

  const resolved = useMemo(() => {
    if (!data?.constants) return null;
    // Keep undefined undefined: the resolver's env-agnostic mode (base only, no
    // flavors) is the all-environments contract — coercing to "" would apply
    // wildcard/project-only overrides in the all-envs view.
    const env = environment;
    const map = buildConstantValueMap(data.constants, env ?? "");
    const project = feature.project || "";
    // Resolve the config base — this flattens the constants the config itself
    // references (and its lineage). Passing `env` applies the config's matching
    // env flavor (scopedOverrides) so the preview matches the per-env payload.
    const base = resolveConstantRefs(
      JSON.parse(setConfigBacking(configKey, "{}")),
      map,
      undefined,
      undefined,
      project,
      env,
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
    // "with overrides" reflects whether this value adds anything on top of the
    // config — its own patch fields (or a `@const:` layer) — NOT whether the
    // resolved value happens to differ from the feature default. Computed from
    // the raw patch, before its own references are resolved.
    const hasOverrides = Object.keys(patch).length > 0;
    // Resolve the patch's own `@const:` refs too, so the preview matches what
    // the SDK ships (the config base above is already resolved).
    const resolvedPatch =
      toObject(
        resolveConstantRefs(patch, map, undefined, undefined, project, env),
      ) ?? patch;
    const baseObj = toObject(base);
    // Deep (targeted) patch onto the resolved base, matching SDK resolution —
    // the patch restates only the leaves it changes. `deepMergePatch` returns
    // the patch as-is when there's no object base to merge onto.
    const merged = deepMergePatch(baseObj, resolvedPatch) as Record<
      string,
      unknown
    >;

    if (!sparse) {
      return { merged, diffKeys: null as Set<string> | null, hasOverrides };
    }

    // Diff against the resolved feature default so a rule shows only what it
    // changes (bold) over the inherited base (muted). The default is itself
    // config-backed and stored as a bare patch (base config) or a layer, so
    // resolve its PATCH onto the SAME config base as `merged` — diffing against
    // the raw default value would omit the base and flag every inherited field
    // as changed.
    let defaultObj: Record<string, unknown> = {};
    try {
      const defaultPatch = (JSON.parse(
        getConfigBackingPatch(feature.defaultValue),
      ) ?? {}) as Record<string, unknown>;
      const resolvedDefaultPatch =
        toObject(
          resolveConstantRefs(
            defaultPatch,
            map,
            undefined,
            undefined,
            project,
            env,
          ),
        ) ?? defaultPatch;
      defaultObj = deepMergePatch(baseObj, resolvedDefaultPatch) as Record<
        string,
        unknown
      >;
    } catch {
      defaultObj = {};
    }
    const diffKeys = new Set(
      Object.keys(merged).filter((k) => !isEqual(merged[k], defaultObj[k])),
    );
    return { merged, diffKeys, hasOverrides };
  }, [
    data,
    value,
    configKey,
    feature.project,
    feature.defaultValue,
    sparse,
    environment,
  ]);

  // Validate the resolved (base + patch) value against the config's own schema.
  // The flag's `jsonSchema` is disabled for config-backed values, so this is the
  // only schema in play — `validateJSONFeatureValue` against the feature would be
  // a no-op here.
  const validationErrors = useMemo(() => {
    if (!hasJsonValidator || !resolved) return null;
    const fields = data?.effectiveSchema;
    if (!fields?.length) return null;
    const { valid, enabled, errors } = validateJSONFeatureValue(
      resolved.merged,
      {
        jsonSchema: {
          schemaType: "simple",
          simple: {
            type: "object",
            fields,
            additionalProperties: data?.extensible ?? true,
          },
          schema: "",
          date: new Date(),
          enabled: true,
        },
      },
    );
    if (!enabled || valid) return null;
    return errors;
  }, [hasJsonValidator, resolved, data?.effectiveSchema, data?.extensible]);

  // Env flavors apply per LAYER, so the cue must consider the whole lineage —
  // an ancestor's flavor changes this config's per-env resolution too.
  const lineageKeys = useMemo(() => {
    const byKey = new Map(configs.map((c) => [c.key, c]));
    const self = byKey.get(configKey);
    return self
      ? [configKey, ...getConfigAncestorKeys(self, byKey)]
      : [configKey];
  }, [configs, configKey]);
  const configByKey = useMemo(
    () => new Map(configs.map((c) => [c.key, c])),
    [configs],
  );

  // In an ambiguous (all-environments) view we show the base value, so flag when
  // any lineage config has env flavors — the served value can differ per env.
  const hasEnvOverrides = lineageKeys.some(
    (k) => (configByKey.get(k)?.scopedOverrides?.length ?? 0) > 0,
  );

  // When previewing a specific environment, tag the header with that env only if
  // some lineage layer actually selects a flavor (a non-base rendering). Match
  // the resolver's scrub: archived, absent, or cross-project flavors don't apply.
  const flavorEligible = (k: string) => {
    const f = configByKey.get(k);
    return (
      !!f &&
      !f.archived &&
      (!f.project || f.project === (feature.project || ""))
    );
  };
  const activeEnvFlavor =
    environment != null &&
    lineageKeys.some((k) =>
      selectScopedOverride(
        configByKey.get(k)?.scopedOverrides,
        { environment, project: feature.project || "" },
        flavorEligible,
      ),
    );

  const fullStyle = {
    maxHeight: maxHeight ?? 150,
    overflowY: "auto" as const,
    maxWidth: "100%",
  };

  return (
    <>
      <ServeConfigHeader
        configKey={configKey}
        name={config?.name ?? configKey}
        suffix={
          [
            !isDefault && resolved?.hasOverrides ? "with overrides" : null,
            !environment && hasEnvOverrides
              ? "(has environment overrides)"
              : null,
            activeEnvFlavor ? `(${environment})` : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {resolved !== null && (
        <Box width="100%" mt="2">
          {sparse && resolved.diffKeys ? (
            <ValueDisplay
              value={JSON.stringify(
                Object.fromEntries(
                  [...resolved.diffKeys].map((k) => [k, resolved.merged[k]]),
                ),
              )}
              type="json"
              sparse
              defaultValue={JSON.stringify(resolved.merged)}
              showFullscreenButton={true}
              fullStyle={fullStyle}
            />
          ) : (
            <ValueDisplay
              value={JSON.stringify(resolved.merged, null, 2)}
              type="json"
              showFullscreenButton={true}
              fullStyle={fullStyle}
            />
          )}
        </Box>
      )}
      {validationErrors && (
        <Callout status="error" mt="2">
          Value fails validation with the config&apos;s JSON schema.
          <ul className="mb-0 mt-1">
            {validationErrors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </Callout>
      )}
    </>
  );
}
