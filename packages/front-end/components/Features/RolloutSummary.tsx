import { FeatureInterface } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import ForceSummary from "./ForceSummary";
import RolloutRow from "./RolloutRow";
import { SampleByField } from "./RuleField";

export default function RolloutSummary({
  value,
  coverage,
  feature,
  hashAttribute,
  fallbackAttribute,
  sparse = false,
  environment,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
  fallbackAttribute?: string;
  monitored?: boolean;
  sparse?: boolean;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (all-environments view) = the base value.
  environment?: string;
}) {
  return (
    <Box>
      <SampleByField
        hashAttribute={hashAttribute}
        fallbackAttribute={fallbackAttribute}
      />
      <RolloutRow coverage={coverage} />
      <ForceSummary
        value={value}
        feature={feature}
        sparse={sparse}
        environment={environment}
      />
    </Box>
  );
}
