import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

interface SavedGroupRowMenuProps {
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  // When set, the Delete row is shown but disabled with this tooltip. Used
  // to surface preconditions like "must be archived first" instead of
  // silently hiding the option from a user who otherwise has permission.
  deleteDisabledReason?: string;
}

export default function SavedGroupRowMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  deleteDisabledReason,
}: SavedGroupRowMenuProps) {
  const [open, setOpen] = useState(false);

  const showDelete = canDelete || !!deleteDisabledReason;

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          mt="1"
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        {canUpdate && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            color="red"
            disabled={!canDelete}
            tooltip={!canDelete ? deleteDisabledReason : undefined}
            onClick={() => {
              if (!canDelete) return;
              onDelete();
              setOpen(false);
            }}
          >
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
