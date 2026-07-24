import React from "react";
import { FeatureValueType } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useDefinitions } from "@/services/DefinitionsContext";

const VALUE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean",
  string: "String",
  number: "Number",
  json: "JSON",
};

// Renders a feature's value type. A config-backed flag (one with a `baseConfig`)
// shows "Config · <Config>" instead of its underlying "JSON" type.
//
// The backing config comes from the flag's first-class `baseConfig` — either
// passed directly, or via `configBackingKey` when already derived server-side
// (e.g. the feature list). Never inferred from the default value.
export default function FeatureValueTypeDisplay({
  valueType,
  configBackingKey,
  baseConfig,
  link = true,
  maxWidth = 300,
}: {
  valueType: FeatureValueType;
  configBackingKey?: string | null;
  baseConfig?: string | null;
  link?: boolean;
  // Max width (px) of the backing-config name before it truncates. Lenient by
  // default (feature overview); tighten on dense surfaces like the list.
  maxWidth?: number;
}): React.ReactElement {
  const { getConfigByKey } = useDefinitions();

  const backingKey = configBackingKey ?? baseConfig ?? null;
  const config = backingKey ? getConfigByKey(backingKey) : null;

  if (!backingKey) return <>{VALUE_TYPE_LABELS[valueType] ?? valueType}</>;

  const name = config?.name ?? backingKey;

  return (
    <Flex as="span" align="center" gap="1" display="inline-flex">
      <span>Config</span>
      <span style={{ color: "var(--slate-9)" }}>·</span>
      {link && config ? (
        <Link
          href={`/configs/${config.key}`}
          className="hover-underline"
          title={`View config: ${name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <OverflowText maxWidth={maxWidth} title={name}>
            {name}
          </OverflowText>
        </Link>
      ) : (
        <OverflowText maxWidth={maxWidth} title={name}>
          {name}
        </OverflowText>
      )}
    </Flex>
  );
}
