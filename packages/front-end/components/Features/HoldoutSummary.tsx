import { FeatureInterface } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import ForceSummary from "./ForceSummary";
import RolloutRow from "./RolloutRow";
import { SampleByField } from "./RuleField";

// A holdout's split, laid out as a rollout's is.
export default function HoldoutSummary({
  value,
  feature,
  hashAttribute,
  holdoutSize,
  environment,
}: {
  value: string;
  feature: FeatureInterface;
  hashAttribute: string;
  holdoutSize: number;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (all-environments view) = the base value.
  environment?: string;
}) {
  return (
    <Box>
      <SampleByField hashAttribute={hashAttribute} />
      <RolloutRow coverage={holdoutSize} label="Holdout" />
      <ForceSummary value={value} feature={feature} environment={environment} />
    </Box>
  );
}
