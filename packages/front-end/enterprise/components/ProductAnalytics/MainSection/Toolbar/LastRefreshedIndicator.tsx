import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiClockClockwise } from "react-icons/pi";
import Text from "@/ui/Text";

const UPDATE_INTERVAL_MS = 10_000;

function formatShortAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface LastRefreshedIndicatorProps {
  lastRefreshedAt: Date | null;
}

export default function LastRefreshedIndicator({
  lastRefreshedAt,
}: LastRefreshedIndicatorProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastRefreshedAt) return;
    const interval = setInterval(
      () => setTick((t) => t + 1),
      UPDATE_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  if (!lastRefreshedAt) return null;

  return (
    <Flex align="center" gap="1">
      <PiClockClockwise style={{ color: "var(--gray-11)", flexShrink: 0 }} />
      <Text size="small" color="text-low">
        {formatShortAgo(lastRefreshedAt)}
      </Text>
    </Flex>
  );
}
