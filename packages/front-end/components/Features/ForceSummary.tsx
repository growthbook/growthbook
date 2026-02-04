import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";

export default function ForceSummary({
  value,
  feature,
}: {
  value: string;
  feature: FeatureInterface;
}) {
  return (
    <>
      <Flex direction="row" gap="2">
        <Text weight="medium">SERVE</Text>
        <Box width="100%">
          <ValueDisplay
            value={value}
            type={feature.valueType}
            showFullscreenButton={true}
          />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
