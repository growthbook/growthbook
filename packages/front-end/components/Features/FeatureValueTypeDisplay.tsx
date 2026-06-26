import React from "react";
import { FeatureValueType } from "shared/types/feature";
import { getConfigBackingKey, getConfigParentKey } from "shared/util";
import { Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import ConfigIcon from "@/components/Configs/ConfigIcon";
import { useDefinitions } from "@/services/DefinitionsContext";

const VALUE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean",
  string: "String",
  number: "Number",
  json: "JSON",
};

// Renders a feature's value type, augmented with its backing config (when the
// default value is config-backed) so JSON flags show "JSON · <Config>".
export default function FeatureValueTypeDisplay({
  valueType,
  defaultValue,
  link = true,
}: {
  valueType: FeatureValueType;
  defaultValue?: string;
  link?: boolean;
}): React.ReactElement {
  const { configs } = useDefinitions();
  const label = VALUE_TYPE_LABELS[valueType] ?? valueType;

  const backingKey =
    valueType === "json" ? getConfigBackingKey(defaultValue ?? "") : null;
  const config = backingKey
    ? (configs.find((c) => c.key === backingKey) ?? null)
    : null;

  if (!backingKey) return <>{label}</>;

  const icon = (
    <ConfigIcon
      isBase={config ? getConfigParentKey(config) === null : true}
      size={18}
    />
  );
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
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          {icon}
          {name}
        </Link>
      ) : (
        <Flex as="span" align="center" gap="1" display="inline-flex">
          {icon}
          {name}
        </Flex>
      )}
    </Flex>
  );
}
