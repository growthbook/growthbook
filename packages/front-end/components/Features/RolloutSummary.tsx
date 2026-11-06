import { FeatureInterface } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { AttributeBadge } from "./AttributeBadge";
import ForceSummary from "./ForceSummary";
import RolloutRow from "./RolloutRow";

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
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SAMPLE</Text> by{" "}
        <AttributeBadge attributeId={hashAttribute} />
        {fallbackAttribute ? (
          <>
            falling back to <AttributeBadge attributeId={fallbackAttribute} />
          </>
        ) : null}
      </Flex>
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
