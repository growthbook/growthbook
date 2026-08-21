import { ReactNode, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp, PiSlidersHorizontal } from "react-icons/pi";
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
  /** Shown on the default trigger. Omit when the caller surfaces it itself. */
  hiddenCount?: number;
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
  /** Appended to the popover's helper copy, e.g. which column is pinned. */
  note?: string;
  /** Overrides the default toolbar trigger, for hosts that need another weight. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        trigger ?? (
          // Matches FilterHeading in components/Search/SearchFilters.tsx so the
          // control reads as part of the same toolbar family.
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
            aria-label="Column settings"
          >
            <Flex gap="2" align="center">
              <Flex gap="1" align="center">
                <PiSlidersHorizontal />
                Columns
                {hiddenCount > 0 && (
                  <Text as="span" color="text-low">
                    · {hiddenCount} hidden
                  </Text>
                )}
              </Flex>
              {open ? <PiCaretUp /> : <PiCaretDown />}
            </Flex>
          </IconButton>
        )
      }
      content={
        <Box style={{ width: 260 }}>
          <Box mb="2">
            <Text size="sm" color="text-low">
              Drag to reorder or toggle visibility.
              {note ? ` ${note}` : ""}
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
