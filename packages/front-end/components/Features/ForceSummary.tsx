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
}: {
  value: string;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
  // The feature's default value (vs a rule). A config-backed default is a pure
  // config with no overrides, so the "with overrides" tag never applies to it.
  isDefault?: boolean;
}) {
  // A config-backed feature's values always serve a config: an explicit ref on
  // this value, else the feature default's config (the base it overrides).
  const configKey =
    getConfigBackingKey(value) ?? getFeatureBaseConfigKey(feature);
  if (configKey !== null) {
    return (
      <ConfigBackedSummary
        value={value}
        configKey={configKey}
        feature={feature}
        maxHeight={maxHeight}
        sparse={sparse}
        isDefault={isDefault}
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
