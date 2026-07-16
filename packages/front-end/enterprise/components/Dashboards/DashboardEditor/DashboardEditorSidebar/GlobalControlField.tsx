import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";

interface Props {
  label: string;
  // Whether a dashboard-wide filter for this field is currently active.
  globalActive: boolean;
  // Whether this block is currently following the dashboard filter.
  controlled: boolean;
  onToggle: (enabled: boolean) => void;
  // Read-only summary of the effective dashboard value, shown when controlled.
  controlledSummary: ReactNode;
  // The editable control, shown when the block is not following the dashboard.
  children: ReactNode;
  // Optional extra control rendered on the right of the label row (e.g. a
  // Compare toggle), preserved from the block's own settings.
  accessory?: ReactNode;
  disabled?: boolean;
}

// Wraps a single block filter field with the opt-in/opt-out toggle used when the
// dashboard exposes a matching global filter. When the block follows the
// dashboard, the local control is replaced by a muted summary of the effective
// value; otherwise the normal editable control is shown.
export default function GlobalControlField({
  label,
  globalActive,
  controlled,
  onToggle,
  controlledSummary,
  children,
  accessory,
  disabled,
}: Props) {
  return (
    <Box>
      <Flex justify="between" align="center" mb="2">
        <Text weight="semibold">{label}</Text>
        <Flex align="center" gap="3">
          {accessory}
          {globalActive ? (
            <Flex align="center" gap="1">
              <Switch
                label="Dashboard filter"
                value={controlled}
                disabled={disabled}
                onChange={onToggle}
              />
              <Tooltip
                body="Follow the dashboard-wide filter instead of this block's own setting."
                tipPosition="left"
              />
            </Flex>
          ) : null}
        </Flex>
      </Flex>
      {controlled ? (
        <Text size="small" color="text-low">
          Using dashboard filter: {controlledSummary}
        </Text>
      ) : (
        children
      )}
    </Box>
  );
}
