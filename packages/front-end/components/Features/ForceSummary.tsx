import { FeatureInterface } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Text from "@/ui/Text";
import ValueDisplay from "./ValueDisplay";

export default function ForceSummary({
  value,
  feature,
  maxHeight,
}: {
  value: string;
  feature: FeatureInterface;
  maxHeight?: number;
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
