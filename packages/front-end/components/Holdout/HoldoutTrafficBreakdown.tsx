import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import Text, { TextProps } from "@/ui/Text";

export default function HoldoutTrafficBreakdown({
  phase,
  color,
}: {
  phase: ExperimentPhaseStringDates;
  color?: TextProps["color"];
}) {
  const traffic = getHoldoutTrafficBreakdown(phase);
  return (
    <Flex direction="column" gap="1">
      <Text color={color}>{traffic.inHoldoutPercent}% in holdout</Text>
      <Text color={color}>
        {traffic.forMeasurementPercent}% not in holdout (for measurement)
      </Text>
      <Text color={color}>
        {traffic.notForMeasurementPercent}% not in holdout (not for measurement)
      </Text>
    </Flex>
  );
}
