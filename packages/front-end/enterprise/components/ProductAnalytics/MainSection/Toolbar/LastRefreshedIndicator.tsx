import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise, PiClockClockwise } from "react-icons/pi";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  formatShortAgo,
  getRefreshInterval,
} from "@/enterprise/components/ProductAnalytics/util";

interface LastRefreshedIndicatorProps {
  lastRefreshedAt: Date | null;
}

export default function LastRefreshedIndicator({
  lastRefreshedAt,
}: LastRefreshedIndicatorProps) {
  const [, setTick] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { handleSubmit, loading, draftExploreState, isSubmittable } =
    useExplorerContext() ?? {};

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

  const isUpdateDisabled =
    loading || !draftExploreState?.dataset?.values?.length || !isSubmittable;

  const trigger = (
    <Flex
      align="center"
      gap="1"
      style={{
        minWidth: "40px",
        cursor: "pointer",
      }}
    >
      <PiClockClockwise style={{ color: "var(--gray-11)", flexShrink: 0 }} />
      <Text size="small" color="text-low">
        {formatShortAgo(lastRefreshedAt)}
      </Text>
    </Flex>
  );

  return (
    <DropdownMenu
      trigger={trigger}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
    >
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={async () => {
            setDropdownOpen(false);
            await handleSubmit?.({ force: true });
          }}
          disabled={isUpdateDisabled}
        >
          <Flex align="center" gap="2">
            <PiArrowsClockwise />
            Update
          </Flex>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
