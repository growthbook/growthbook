import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { Trans } from "@lingui/react/macro";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import Text, { TextProps } from "@/ui/Text";

export default function HoldoutTrafficBreakdown({
  phase,
  color,
}: {
  phase: ExperimentPhaseStringDates;
  color?: TextProps["color"];
}) {
  const { inHoldoutPercent, forMeasurementPercent, notForMeasurementPercent } =
    getHoldoutTrafficBreakdown(phase);
  return (
    <Flex direction="column" gap="1">
      <Text color={color}>
        <Trans>{inHoldoutPercent}% in holdout</Trans>
      </Text>
      <Text color={color}>
        <Trans>{forMeasurementPercent}% not in holdout (for measurement)</Trans>
      </Text>
      <Text color={color}>
        <Trans>
          {notForMeasurementPercent}% not in holdout (not for measurement)
        </Trans>
      </Text>
    </Flex>
  );
}
