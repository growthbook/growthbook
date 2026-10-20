import { Fragment, ReactNode, useState } from "react";
import { DashboardBlockType } from "shared/enterprise";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import {
  BLOCK_SUBGROUPS,
  BLOCK_TYPE_INFO,
  getAvailableBlockTypes,
} from "./dashboardBlockTypes";

export function DashboardBlockTypeMenuItems({
  isGeneralDashboard,
  onSelect,
  filterBlockType,
}: {
  isGeneralDashboard: boolean;
  onSelect: (blockType: DashboardBlockType) => void;
  filterBlockType?: (blockType: DashboardBlockType) => boolean;
}) {
  const availableBlockTypes = new Set(
    getAvailableBlockTypes(isGeneralDashboard).filter(
      (blockType) => !filterBlockType || filterBlockType(blockType),
    ),
  );

  return (
    <>
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], index) => {
        const filteredBlockTypes = blockTypes.filter((blockType) =>
          availableBlockTypes.has(blockType),
        );
        if (filteredBlockTypes.length === 0) return null;

        return (
          <Fragment key={subgroup}>
            <DropdownMenuLabel>
              <Text color="text-high" weight="semibold">
                {subgroup}
              </Text>
            </DropdownMenuLabel>
            {filteredBlockTypes.map((blockType) => (
              <DropdownMenuItem
                key={blockType}
                onClick={() => onSelect(blockType)}
              >
                {BLOCK_TYPE_INFO[blockType].name}
              </DropdownMenuItem>
            ))}
            {index < BLOCK_SUBGROUPS.length - 1 && <DropdownMenuSeparator />}
          </Fragment>
        );
      })}
    </>
  );
}

export function AddBlockDropdown({
  trigger,
  addBlockType,
  onDropdownOpen,
  onDropdownClose,
  isGeneralDashboard = false,
  filterBlockType,
}: {
  trigger: ReactNode;
  addBlockType: (blockType: DashboardBlockType) => void;
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
  isGeneralDashboard?: boolean;
  filterBlockType?: (blockType: DashboardBlockType) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      onDropdownOpen?.();
    } else {
      onDropdownClose?.();
    }
  };

  return (
    <DropdownMenu
      variant="solid"
      open={open}
      onOpenChange={updateOpen}
      trigger={trigger}
    >
      <DashboardBlockTypeMenuItems
        isGeneralDashboard={isGeneralDashboard}
        filterBlockType={filterBlockType}
        onSelect={(blockType) => {
          updateOpen(false);
          addBlockType(blockType);
        }}
      />
    </DropdownMenu>
  );
}
