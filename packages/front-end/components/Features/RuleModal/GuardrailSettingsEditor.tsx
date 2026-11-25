import { Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const guardrailCount = guardrailMetricIds.length;
  const signalCount = signalMetricIds.length;

  if (guardrailCount === 0 && signalCount === 0) {
    return (
      <Text size="sm" color="text-low">
        <Trans>No guardrail metrics</Trans>
      </Text>
    );
  }

  return (
    <Flex align="center" gap="2" wrap="wrap">
      {guardrailCount > 0 && (
        <Badge
          label={
            guardrailCount !== 1
              ? t`${guardrailCount} guardrails`
              : t`${guardrailCount} guardrail`
          }
          color="red"
          radius="full"
        />
      )}
      {signalCount > 0 && (
        <Badge
          label={
            signalCount !== 1
              ? t`${signalCount} signals`
              : t`${signalCount} signal`
          }
          color="amber"
          radius="full"
        />
      )}
    </Flex>
  );
}
