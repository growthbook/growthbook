import { FeatureInterface } from "shared/types/feature";
import { getConfigBackingKey, getFeatureBaseConfigKey } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Text from "@/ui/Text";
import ValueDisplay from "./ValueDisplay";
import ConfigBackedSummary from "./ConfigBackedSummary";

export default function ForceSummary({
  value,
  feature,
  maxHeight,
  sparse = false,
  isDefault = false,
  environment,
}: {
  value: string;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
  // The feature's default value (vs a rule). A config-backed default is a pure
  // config with no overrides, so the "with overrides" tag never applies to it.
  isDefault?: boolean;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (e.g. all-environments view) = the base value.
  environment?: string;
}) {
  // Mirror the SDK compiler: a value resolves a config ONLY when the feature is
  // config-backed (baseConfig set). A stray `@config:` hand-typed into a plain
  // flag's value is stripped at serve time, so it must not be previewed as backed.
  const baseConfigKey = getFeatureBaseConfigKey(feature);
  const configKey =
    baseConfigKey !== null
      ? (getConfigBackingKey(value) ?? baseConfigKey)
      : null;
  if (configKey !== null) {
    return (
      <ConfigBackedSummary
        value={value}
        configKey={configKey}
        feature={feature}
        maxHeight={maxHeight}
        sparse={sparse}
        isDefault={isDefault}
        environment={environment}
      />
    );
  }

  return (
    <>
      <Flex direction="row" gap="2">
        <Text weight="medium">SERVE</Text>
        <Box width="100%">
          <ValueDisplay
            value={value}
            type={feature.valueType}
            showFullscreenButton={true}
            sparse={sparse}
            defaultValue={feature.defaultValue}
            fullStyle={{
              maxHeight: maxHeight ?? 150,
              overflowY: "auto",
              maxWidth: "100%",
            }}
          />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
