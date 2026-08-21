import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import ColumnSettings, { ManagedColumn } from "@/ui/ColumnSettings";

export default function ColumnSettingsButton({
  columns,
  hiddenCount,
  onChange,
  onReset,
  canReset,
  lockedNote,
}: {
  columns: ManagedColumn[];
  hiddenCount: number;
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
  lockedNote?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Link size="sm" style={{ whiteSpace: "nowrap" }}>
          <Flex align="center" gap="1">
            <PiSlidersHorizontal />
            Columns
            {hiddenCount > 0 && (
              <Text as="span" color="text-low">
                · {hiddenCount} hidden
              </Text>
            )}
          </Flex>
        </Link>
      }
      content={
        <Box style={{ width: 260 }}>
          <Box mb="2">
            <Text size="sm" color="text-low">
              Drag to reorder or toggle visibility.
              {lockedNote ? ` ${lockedNote}` : ""}
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
