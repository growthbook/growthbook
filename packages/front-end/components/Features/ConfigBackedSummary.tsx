import { FeatureInterface, SchemaField } from "shared/types/feature";
import { getConfigBackingPatch, validateJSONFeatureValue } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { ReactNode, useMemo } from "react";
import { isEqual } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import {
  ResolvableInput,
  resolveConfigBackedValue,
} from "@/services/configBackedValue";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import ValueDisplay from "./ValueDisplay";
import { ActionsOverlay } from "./CornerActions";
import {
  ConfigEnvironmentsBadge,
  ConfigOverridesBadge,
} from "./ConfigValueBadges";
import RuleField from "./RuleField";

// The config a value serves. The name links to the config detail page; the
// internal `@config:` directive is never surfaced.
function ServeConfigHeader({
  configKey,
  name,
  badges,
}: {
  configKey: string;
  name: string;
  badges: ReactNode;
}) {
  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Link href={`/configs/${configKey}`} target="_blank" rel="noreferrer">
        {name}
      </Link>
      {badges}
    </Flex>
  );
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
  label = "Serve",
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
    const project = feature.project || "";
    const resolve = (v: string) =>
      resolveConfigBackedValue({
        inputs: data.constants,
        configKey,
        value: v,
        project,
        environment,
      });
    const merged = resolve(value);
    // The fields this value sets on top of the config — its own patch, NOT
    // whatever happens to differ from the feature default. `$` keys like
    // `$extends` are directives, not fields.
    let overrideFields: string[] = [];
    try {
      overrideFields = Object.keys(
        (JSON.parse(getConfigBackingPatch(value)) ?? {}) as Record<
          string,
          unknown
        >,
      ).filter((k) => !k.startsWith("$"));
    } catch {
      overrideFields = [];
    }

    if (!sparse) {
      return { merged, diffKeys: null as Set<string> | null, overrideFields };
    }

    // Diff against the resolved feature default so a rule shows only what it
    // changes (bold) over the inherited base (muted). The default is itself
    // config-backed and stored as a bare patch (base config) or a layer, so
    // resolve its patch onto the SAME config base as `merged` — diffing against
    // the raw default value would omit the base and flag every inherited field
    // as changed.
    const defaultObj = resolve(feature.defaultValue);
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

  const content = (
    <>
      <ServeConfigHeader
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

  return label !== null ? (
    <RuleField label={label} mb="0">
      {content}
    </RuleField>
  ) : (
    content
  );
}
