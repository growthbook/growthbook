import React from "react";
import { FeatureValueType } from "shared/types/feature";
import { getConfigBackingKey } from "shared/util";
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

// Renders a feature's value type, augmented with its backing config (when the
// default value is config-backed) so JSON flags show "JSON · <Config>".
//
// Pass `configBackingKey` when it's already known (e.g. the feature list, where
// it's derived server-side) to avoid shipping/parsing every default value;
// otherwise it's derived from `defaultValue`.
export default function FeatureValueTypeDisplay({
  valueType,
  defaultValue,
  configBackingKey,
  link = true,
  maxWidth = 300,
}: {
  valueType: FeatureValueType;
  defaultValue?: string;
  configBackingKey?: string | null;
  link?: boolean;
  // Max width (px) of the backing-config name before it truncates. Lenient by
  // default (feature overview); tighten on dense surfaces like the list.
  maxWidth?: number;
}): React.ReactElement {
  const { getConfigByKey } = useDefinitions();
  const label = VALUE_TYPE_LABELS[valueType] ?? valueType;

  const backingKey =
    configBackingKey ??
    (valueType === "json" ? getConfigBackingKey(defaultValue ?? "") : null);
  const config = backingKey ? getConfigByKey(backingKey) : null;

  if (!backingKey) return <>{label}</>;

  const name = config?.name ?? backingKey;

  return (
    <Flex as="span" align="center" gap="1" display="inline-flex">
      <span>{label},</span>
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
