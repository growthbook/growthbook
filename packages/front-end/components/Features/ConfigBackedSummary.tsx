import { FeatureInterface, SchemaField } from "shared/types/feature";
import { ConstantInterface } from "shared/types/constant";
import {
  getConfigBackingPatch,
  setConfigBacking,
  validateJSONFeatureValue,
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
      <Flex as="span" align="center" gap="2">
        <a href={`/configs/${configKey}`} target="_blank" rel="noreferrer">
          {name}
        </a>
        {suffix && <Text>{suffix}</Text>}
      </Flex>
    </Flex>
  );
}

// Value-map inputs from the config "resolved" endpoint (constants + configs,
// each tagged with its namespace source).
type ResolvableInput = Pick<
  ConstantInterface,
  "key" | "type" | "value" | "project" | "archived"
> & { source: ConstantSource };

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
//   default — overridden fields bold, inherited base fields muted — with a
//   "with overrides" tag when anything differs.
export default function ConfigBackedSummary({
  value,
  configKey,
  feature,
  maxHeight,
  sparse = false,
}: {
  value: string;
  configKey: string;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
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
    const map = buildConstantValueMap(data.constants, "");
    const project = feature.project || "";
    // Resolve only the config base — this flattens the constants the config
    // itself references (and its lineage). The override patch is merged on top
    // raw, so any constants referenced inline on this value stay unresolved.
    const base = resolveConstantRefs(
      JSON.parse(setConfigBacking(configKey, "{}")),
      map,
      undefined,
      undefined,
      project,
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
    const baseObj = toObject(base);
    const merged = baseObj ? { ...baseObj, ...patch } : patch;

    if (!sparse) return { merged, diffKeys: null as Set<string> | null };

    // Diff against the resolved feature default so a rule shows only what it
    // changes (bold) over the inherited base (muted).
    let defaultObj: Record<string, unknown> = {};
    try {
      const resolvedDefault = resolveConstantRefs(
        JSON.parse(feature.defaultValue),
        map,
        undefined,
        undefined,
        project,
      );
      defaultObj = toObject(resolvedDefault) ?? {};
    } catch {
      defaultObj = {};
    }
    const diffKeys = new Set(
      Object.keys(merged).filter((k) => !isEqual(merged[k], defaultObj[k])),
    );
    return { merged, diffKeys };
  }, [data, value, configKey, feature.project, feature.defaultValue, sparse]);

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
        configKey={configKey}
        name={config?.name ?? configKey}
        suffix={resolved?.diffKeys?.size ? "with overrides" : undefined}
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
