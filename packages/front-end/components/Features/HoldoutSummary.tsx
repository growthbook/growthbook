import { FeatureInterface } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import { AttributeBadge } from "./AttributeBadge";
import ValueDisplay from "./ValueDisplay";
import RolloutRow from "./RolloutRow";
import RuleField from "./RuleField";

// A holdout's split, laid out as a rollout's is.
export default function HoldoutSummary({
  value,
  feature,
  hashAttribute,
  holdoutSize,
}: {
  value: string;
  feature: FeatureInterface;
  hashAttribute: string;
  holdoutSize: number;
}) {
  return (
    <Box>
      <RuleField label="Sample by">
        <AttributeBadge attributeId={hashAttribute} />
      </RuleField>
      <RolloutRow coverage={holdoutSize} label="Holdout" />
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
