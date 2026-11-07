import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
import { coveragePercentFormatter } from "@/services/utils";
import { AttributeBadge } from "./AttributeBadge";
import ValueDisplay from "./ValueDisplay";
import RuleField from "./RuleField";

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
      <RuleField label="Holdout">
        <Flex align="center" gap="2" wrap="wrap">
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
      </RuleField>
      <RuleField label="Serve" mb="0">
        <ValueDisplay
          value={value}
          type={feature.valueType}
          showFullscreenButton={true}
          actionsOverlay={{ inline: true }}
        />
      </RuleField>
      <ValidateValue value={value} feature={feature} />
    </Box>
  );
}
