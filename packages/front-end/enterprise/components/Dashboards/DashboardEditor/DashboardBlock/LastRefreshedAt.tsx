import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiClockClockwise } from "react-icons/pi";
import Text from "@/ui/Text";
import {
  formatShortAgo,
  getRefreshInterval,
} from "@/enterprise/components/ProductAnalytics/util";

interface LastRefreshedAtProps {
  lastRefreshedAt: Date | null;
}

export default function LastRefreshedAt({
  lastRefreshedAt,
}: LastRefreshedAtProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastRefreshedAt) return;

    const elapsedSeconds = Math.floor(
      (Date.now() - lastRefreshedAt.getTime()) / 1000,
    );
    const intervalMs = getRefreshInterval(elapsedSeconds);

    const interval = setInterval(() => {
      setTick((t) => t + 1);

      const newElapsedSeconds = Math.floor(
        (Date.now() - lastRefreshedAt.getTime()) / 1000,
      );
      const newIntervalMs = getRefreshInterval(newElapsedSeconds);

      if (newIntervalMs !== intervalMs) {
        clearInterval(interval);
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  if (!lastRefreshedAt) return null;

  return (
    <Flex align="center" gap="1" style={{ minWidth: "40px" }}>
      <PiClockClockwise style={{ color: "var(--gray-11)", flexShrink: 0 }} />
      <Text size="small" color="text-low">
        {formatShortAgo(lastRefreshedAt)}
      </Text>
    </Flex>
  );
}
