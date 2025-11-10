import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
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
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">HOLDOUT</Text>
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>
              {percentFormatter.format(holdoutWeight)}
            </Text>
          }
        />
        of
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>{hashAttribute}</Text>
          }
        />
      </Flex>
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
