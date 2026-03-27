import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise, PiClockClockwise } from "react-icons/pi";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import {
  formatShortAgo,
  getRefreshInterval,
} from "@/enterprise/components/ProductAnalytics/util";

interface LastRefreshedIndicatorProps {
  lastRefreshedAt: Date | null;
  /** When provided, shows a dropdown with an "Update" action that calls this. */
  onUpdate?: () => void | Promise<void>;
  /** When onUpdate is provided, disables the Update menu item when true. */
  isUpdateDisabled?: boolean;
}

export default function LastRefreshedIndicator({
  lastRefreshedAt,
  onUpdate,
  isUpdateDisabled = false,
}: LastRefreshedIndicatorProps) {
  const [, setTick] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);

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

  const trigger = (
    <Flex
      align="center"
      gap="1"
      style={{
        minWidth: "40px",
        cursor: onUpdate ? "pointer" : undefined,
      }}
    >
      <PiClockClockwise style={{ color: "var(--gray-11)", flexShrink: 0 }} />
      <Text size="small" color="text-low">
        {formatShortAgo(lastRefreshedAt)}
      </Text>
    </Flex>
  );

  if (!onUpdate) {
    return trigger;
  }

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
            await onUpdate();
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
