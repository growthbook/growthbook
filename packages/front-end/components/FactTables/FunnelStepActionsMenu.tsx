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
import styles from "./FunnelStepActionsMenu.module.scss";

const MENU_ITEM_STYLE: React.CSSProperties = {
  height: 28,
  paddingLeft: 8,
  paddingRight: 8,
  fontSize: "var(--font-size-1)",
};

// Edge-to-edge, unlike DropdownMenuSeparator.
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
 * Funnel step ⋯ menu (Explorer and metric editor).
 * - inapplicable actions are hidden; none left, no menu
 * - deleting a step with filters asks inline first
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
  // "Delete step" unmounts on confirm; keep keyboard focus on Cancel.
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
        <Flex align="center" justify="between" gap="5" pl="2">
          <Text size="sm" weight="medium">
            Delete?
          </Text>
          <Flex align="center" gap="2">
            <DropdownMenuItem
              className={`${styles.cancel} ${cancelDeleteClass}`}
              style={MENU_ITEM_STYLE}
              onClick={(event) => {
                event.preventDefault(); // stay open
                setConfirmingDelete(false);
              }}
            >
              Cancel
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.confirm}
              style={MENU_ITEM_STYLE}
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
            if (!rowFilters.some(isRowFilterComplete)) {
              onDelete();
              return;
            }
            event.preventDefault(); // stay open
            setConfirmingDelete(true);
          }}
        >
          Delete step
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
