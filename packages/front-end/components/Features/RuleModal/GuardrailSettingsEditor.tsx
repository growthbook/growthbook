import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";

interface GuardrailTierSummaryProps {
  guardrailMetricIds: string[];
  signalMetricIds: string[];
}

export function GuardrailTierSummary({
  guardrailMetricIds,
  signalMetricIds,
}: GuardrailTierSummaryProps) {
  const guardrailCount = guardrailMetricIds.length;
  const signalCount = signalMetricIds.length;

  if (guardrailCount === 0 && signalCount === 0) {
    return (
      <Text size="small" color="text-low">
        No guardrail metrics
      </Text>
    );
  }

  return (
    <Flex align="center" gap="2" wrap="wrap">
      {guardrailCount > 0 && (
        <Badge
          label={`${guardrailCount} guardrail${guardrailCount !== 1 ? "s" : ""}`}
          color="red"
          radius="full"
        />
      )}
      {signalCount > 0 && (
        <Badge
          label={`${signalCount} signal${signalCount !== 1 ? "s" : ""}`}
          color="amber"
          radius="full"
        />
      )}
    </Flex>
  );
}
