import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiClockClockwise } from "react-icons/pi";
import Text from "@/ui/Text";

function formatShortAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getRefreshInterval(elapsedSeconds: number): number {
  if (elapsedSeconds < 60) return 10_000; // 0-59s: update every 10s
  if (elapsedSeconds < 3600) return 60_000; // 1-59m: update every 60s
  if (elapsedSeconds < 86400) return 300_000; // 1-23h: update every 5m
  return 900_000; // 24h+: update every 15m
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

    // Calculate initial interval
    const elapsedSeconds = Math.floor(
      (Date.now() - lastRefreshedAt.getTime()) / 1000,
    );
    const intervalMs = getRefreshInterval(elapsedSeconds);

    const interval = setInterval(() => {
      setTick((t) => t + 1);

      // Recalculate interval for next update
      const newElapsedSeconds = Math.floor(
        (Date.now() - lastRefreshedAt.getTime()) / 1000,
      );
      const newIntervalMs = getRefreshInterval(newElapsedSeconds);

      // If interval should change, restart the timer
      if (newIntervalMs !== intervalMs) {
        clearInterval(interval);
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  if (!lastRefreshedAt) return null;

  return (
    <Flex align="center" gap="1" style={{ minWidth: "85px" }}>
      <PiClockClockwise style={{ color: "var(--gray-11)", flexShrink: 0 }} />
      <Text size="small" color="text-low">
        {formatShortAgo(lastRefreshedAt)}
      </Text>
    </Flex>
  );
}
