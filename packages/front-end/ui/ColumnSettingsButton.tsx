import { ReactNode, useState } from "react";
import { Box, IconButton } from "@radix-ui/themes";
import { PiTextColumns } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import ColumnSettings, { ManagedColumn } from "@/ui/ColumnSettings";

export default function ColumnSettingsButton({
  columns,
  hiddenCount = 0,
  onChange,
  onReset,
  canReset,
  note,
  trigger,
}: {
  columns: ManagedColumn[];
  /** Named on the default trigger, which has no room to show it. */
  hiddenCount?: number;
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
  /** Appended to the popover's helper copy, e.g. which column is pinned. */
  note?: string;
  /** Overrides the default trigger, for hosts that need another weight. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const label = hiddenCount > 0 ? `Columns, ${hiddenCount} hidden` : "Columns";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        trigger ?? (
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            // Matches the row-action kebab below it, so the two line up.
            size="2"
            highContrast
            aria-label={label}
            title={label}
          >
            <PiTextColumns size={18} />
          </IconButton>
        )
      }
      content={
        <Box style={{ width: 260 }}>
          <Box mb="2">
            <Text size="sm" color="text-low">
              Drag to reorder; check to show or hide. Saved in this browser
              only, not shared with your team.{note ? ` ${note}` : ""}
            </Text>
          </Box>
          <ColumnSettings
            columns={columns}
            onChange={onChange}
            onReset={onReset}
            canReset={canReset}
          />
        </Box>
      }
    />
  );
}
