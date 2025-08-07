import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function HoldoutSummary({
  value,
  feature,
  hashAttribute,
  holdoutWeight,
}: {
  value: string;
  feature: FeatureInterface;
  hashAttribute: string;
  holdoutWeight: number;
}) {
  return (
    <>
      <Flex gap="3" mb="3">
        <Box>
          <strong className="font-weight-semibold">HOLDOUT</strong>
        </Box>
        <Box>
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {percentFormatter.format(holdoutWeight)}
          </span>{" "}
          of{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {hashAttribute}
          </span>
        </Box>
      </Flex>
      <Flex gap="3">
        <Box>
          <strong className="font-weight-semibold">SERVE</strong>
        </Box>
        <Box>
          <ValueDisplay value={value} type={feature.valueType} />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
