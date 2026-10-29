import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
import { coveragePercentFormatter } from "@/services/utils";
import { AttributeBadge } from "./AttributeBadge";
import ValueDisplay from "./ValueDisplay";

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
    <Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">HOLDOUT</Text>
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>
              {coveragePercentFormatter.format(holdoutWeight)}
            </Text>
          }
        />
        of
        <AttributeBadge attributeId={hashAttribute} />
      </Flex>
      <Flex gap="3">
        <Box>
          <Text weight="medium">SERVE</Text>
        </Box>
        <Box flexGrow="1">
          <ValueDisplay
            value={value}
            type={feature.valueType}
            showFullscreenButton={true}
          />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </Box>
  );
}
