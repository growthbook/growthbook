import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex } from "@radix-ui/themes";
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
      <Flex gap="3">
        <Box>
          <strong className="font-weight-semibold">SERVE</strong>
        </Box>
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
