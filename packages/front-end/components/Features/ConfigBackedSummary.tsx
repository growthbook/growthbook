import { FeatureInterface, SchemaField } from "shared/types/feature";
import { ConstantInterface } from "shared/types/constant";
import {
  getConfigBackingPatch,
  setConfigBacking,
  validateJSONFeatureValue,
  deepMergePatch,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantSource,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import { ReactNode, useMemo } from "react";
import { isEqual } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import ValueDisplay from "./ValueDisplay";
import { ActionsOverlay } from "./CornerActions";
import {
  ConfigEnvironmentsBadge,
  ConfigOverridesBadge,
} from "./ConfigValueBadges";

// Shared "SERVE ConfigName" header. The name links to the config detail page;
// the internal `@config:` directive is never surfaced.
function ServeConfigHeader({
  configKey,
  name,
  badges,
  label,
}: {
  configKey: string;
  name: string;
  badges: ReactNode;
  label: string | null;
}) {
  return (
    <Flex direction="row" gap="4" align="center">
      {label !== null && <Text weight="medium">{label}</Text>}
      <Flex align="center" gap="2" wrap="wrap">
        <Link href={`/configs/${configKey}`} target="_blank" rel="noreferrer">
          {name}
        </Link>
        {badges}
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
// A badge counts the fields the value overrides from the config. Config +
// patch constants are all resolved so the preview matches the SDK payload.
export default function ConfigBackedSummary({
  value,
  configKey,
  feature,
  maxHeight,
  sparse = false,
  isDefault = false,
  environment,
  label = "SERVE",
  lineHeight,
  actionsOverlay,
}: {
  value: string;
  configKey: string;
  label?: string | null;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
  // A config-backed default is a pure config, so it never counts overrides.
  isDefault?: boolean;
  // The environment this value is being previewed for, so the config resolves
  // with its matching env flavor (scopedOverrides). Absent = the base value.
  environment?: string;
  lineHeight?: number;
  actionsOverlay?: ActionsOverlay;
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
    // The fields this value sets on top of the config — its own patch, NOT
    // whatever happens to differ from the feature default. Read from the raw
    // patch, before its own references are resolved. `$` keys like `$extends`
    // are directives, not fields.
    const overrideFields = Object.keys(patch).filter((k) => !k.startsWith("$"));
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
      return { merged, diffKeys: null as Set<string> | null, overrideFields };
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
    return { merged, diffKeys, overrideFields };
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

  const fullStyle = {
    maxHeight: maxHeight ?? 150,
    overflowY: "auto" as const,
    maxWidth: "100%",
  };

  return (
    <>
      <ServeConfigHeader
        label={label}
        configKey={configKey}
        name={config?.name ?? configKey}
        badges={
          // In the order they apply: the Config's environment overrides,
          // then this value's own.
          <>
            <ConfigEnvironmentsBadge
              configKey={configKey}
              project={feature.project || ""}
              environment={environment ?? null}
            />
            {!isDefault && resolved ? (
              <ConfigOverridesBadge fields={resolved.overrideFields} />
            ) : null}
          </>
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
              lineHeight={lineHeight}
              actionsOverlay={actionsOverlay}
            />
          ) : (
            <ValueDisplay
              value={JSON.stringify(resolved.merged, null, 2)}
              type="json"
              showFullscreenButton={true}
              fullStyle={fullStyle}
              lineHeight={lineHeight}
              actionsOverlay={actionsOverlay}
            />
          )}
        </Box>
      )}
      {validationErrors && (
        <Callout status="error" mt="2">
          Value fails validation with the Config&apos;s JSON schema.
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
