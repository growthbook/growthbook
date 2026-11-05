import React, { useEffect, useId, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { isRowFilterComplete } from "@/components/FactTables/rowFilterUtils";

// Compact rows (design feedback on PR #7588).
const MENU_ITEM_STYLE: React.CSSProperties = {
  height: 28,
  paddingLeft: 8,
  paddingRight: 8,
  fontSize: "var(--font-size-1)",
};

/** Edge-to-edge divider; the shared separator insets by item padding. */
function MenuDivider() {
  const bleed = "calc(-1 * var(--base-menu-content-padding))";
  return (
    <Box
      role="separator"
      my="1"
      style={{
        height: 1,
        marginLeft: bleed,
        marginRight: bleed,
        backgroundColor: "var(--gray-a6)",
      }}
    />
  );
}

/**
 * The ⋯ menu on a funnel step (Explorer builder and funnel metric editor).
 * - actions that don't apply are hidden, not disabled; no actions, no menu
 * - deleting a step with any filled-in filter asks inline first
 */
export default function FunnelStepActionsMenu({
  rowFilters,
  canInsertAbove,
  canInsertBelow,
  canDelete,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  triggerStyle,
}: {
  rowFilters: RowFilter[];
  canInsertAbove: boolean;
  canInsertBelow: boolean;
  canDelete: boolean;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  triggerStyle?: React.CSSProperties;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // "Delete step" unmounts when the confirm row appears; move focus to Cancel
  // so keyboard users aren't left without a focused item.
  const cancelDeleteClass = `funnel-step-cancel-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    if (!confirmingDelete) return;
    document.querySelector<HTMLElement>(`.${cancelDeleteClass}`)?.focus();
  }, [confirmingDelete, cancelDeleteClass]);

  const hasInsertGroup = canInsertAbove || canInsertBelow;
  if (!hasInsertGroup && !canDelete) return null;

  return (
    <DropdownMenu
      menuPlacement="end"
      onOpenChange={(open) => {
        if (!open) setConfirmingDelete(false);
      }}
      trigger={
        <MoreMenuTrigger label="Step actions" size="sm" style={triggerStyle} />
      }
    >
      {canInsertAbove && (
        <DropdownMenuItem style={MENU_ITEM_STYLE} onClick={onInsertAbove}>
          Insert step above
        </DropdownMenuItem>
      )}
      {canInsertBelow && (
        <DropdownMenuItem style={MENU_ITEM_STYLE} onClick={onInsertBelow}>
          Insert step below
        </DropdownMenuItem>
      )}
      {canDelete && hasInsertGroup && <MenuDivider />}
      {!canDelete ? null : confirmingDelete ? (
        // Menu items (not plain buttons) so arrow keys reach them.
        <Flex align="center" justify="between" gap="5" pl="2">
          <Text size="sm" weight="medium">
            Delete?
          </Text>
          <Flex align="center" gap="2">
            <DropdownMenuItem
              className={cancelDeleteClass}
              // Gray outline; inline bg/color also beat the purple highlight
              // Radix gives the focused item.
              style={{
                ...MENU_ITEM_STYLE,
                backgroundColor: "transparent",
                color: "var(--gray-12)",
                boxShadow: "inset 0 0 0 1px var(--gray-a7)",
              }}
              onClick={(event) => {
                event.preventDefault(); // stay open, back to "Delete step"
                setConfirmingDelete(false);
              }}
            >
              Cancel
            </DropdownMenuItem>
            <DropdownMenuItem
              style={{
                ...MENU_ITEM_STYLE,
                backgroundColor: "var(--red-9)",
                color: "var(--red-contrast)",
              }}
              onClick={onDelete}
            >
              Confirm
            </DropdownMenuItem>
          </Flex>
        </Flex>
      ) : (
        <DropdownMenuItem
          style={MENU_ITEM_STYLE}
          color="red"
          onClick={(event) => {
            // Empty steps go right away; anything with a filter asks first.
            if (!rowFilters.some(isRowFilterComplete)) {
              onDelete();
              return;
            }
            event.preventDefault(); // keep the menu open for the confirm row
            setConfirmingDelete(true);
          }}
        >
          Delete step
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
