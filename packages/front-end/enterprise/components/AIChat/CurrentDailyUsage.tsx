import React from "react";
import { Box, Flex, Progress } from "@radix-ui/themes";
import type { ProgressProps } from "@radix-ui/themes";
import { PiSparkle } from "react-icons/pi";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import { isCloud } from "@/services/env";
import { useAITokenUsage } from "@/enterprise/hooks/useAITokenUsage";

function getUsageColor(pct: number): ProgressProps["color"] {
  if (pct >= 90) return "red";
  if (pct >= 75) return "amber";
  return "violet";
}

export default function CurrentDailyUsage() {
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
            Daily AI Usage
          </Text>
        </Flex>
        <Text size="small" color="text-low">
          {Math.round(pct)}%
        </Text>
      </Flex>
      <Progress value={pct} color={getUsageColor(pct)} size="3" />
    </Flex>
  );
}
