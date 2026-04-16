import { Box, Flex, Progress } from "@radix-ui/themes";
import { PiClock, PiSparkle } from "react-icons/pi";
import Text from "@/ui/Text";
import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";
import { useAITokenUsage } from "@/enterprise/hooks/useAITokenUsage";
import Badge from "@/ui/Badge";

function formatResetInLabel(nextResetAtMs: number): string {
  const remainingMs = Math.max(0, nextResetAtMs - Date.now());
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    if (hours >= 12) {
      return `Resets tomorrow`;
    }
    return `Resets in ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `Resets in ${hours}h`;
  }
  if (minutes > 0) {
    return `Resets in ${minutes}m`;
  }
  return "Resets soon";
}

function getUsageStatus(
  pct: number,
): "" | "Running low" | "Almost out" | "Out of tokens" {
  if (pct >= 80 && pct < 90) {
    return "Running low";
  } else if (pct >= 90 && pct < 100) {
    return "Almost out";
  } else if (pct >= 100) {
    return "Out of tokens";
  }
  return "";
}

function getUsageStatusColor(
  usageStatus: "" | "Running low" | "Almost out" | "Out of tokens",
): "amber" | "red" | "violet" {
  if (usageStatus === "Running low") {
    return "amber";
  } else if (usageStatus === "Almost out" || usageStatus === "Out of tokens") {
    return "red";
  }
  return "violet";
}

const UsageBadge = ({ pct }: { pct: number }) => {
  const usageStatus = getUsageStatus(pct);
  if (!usageStatus) return null;

  return (
    <Badge
      label={usageStatus}
      color={getUsageStatusColor(usageStatus)}
      radius="full"
    />
  );
};

export default function AIUsageWidget() {
  const { data, error, isLoading } = useAITokenUsage();

  if (!isCloud()) return null;

  if (error) {
    return (
      <Box px="2" pb="3" pt="1" flexShrink="0">
        <Callout status="error" size="sm">
          {error.message || "Unable to load usage data"}
        </Callout>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box px="2" py="3">
        <Box
          style={{
            height: 24,
            borderRadius: 4,
            background: "var(--gray-a3)",
          }}
        />
      </Box>
    );
  }

  if (!data) {
    return (
      <Box px="2" pb="3" pt="1" flexShrink="0">
        <Text size="small" color="text-low">
          No usage data available
        </Text>
      </Box>
    );
  }

  const { numTokensUsed, dailyLimit } = data;
  const pct = Math.min((numTokensUsed / dailyLimit) * 100, 100);

  return (
    <Flex
      direction="column"
      px="2"
      pb="3"
      pt="4"
      gap="2"
      flexShrink="0"
      style={{ borderTop: "1px solid var(--slate-a4)" }}
    >
      <Flex justify="between" align="center">
        <Flex align="center" direction="row" gap="1">
          <PiSparkle color="var(--violet-9)" size={15} />
          <Text size="small" weight="medium" color="text-mid">
            Daily usage
          </Text>
        </Flex>
        <Flex align="center" direction="row" gap="1">
          <UsageBadge pct={Math.round(pct)} />
          <Text size="small" color="text-low">
            {Math.round(pct)}%
          </Text>
        </Flex>
      </Flex>
      <Progress
        value={pct}
        color={getUsageStatusColor(getUsageStatus(pct))}
        size="3"
      />
      <Text size="small" color="text-low">
        <Flex align="center" direction="row" gap="1">
          <PiClock />
          {formatResetInLabel(data.nextResetAt)}
        </Flex>
      </Text>
    </Flex>
  );
}
