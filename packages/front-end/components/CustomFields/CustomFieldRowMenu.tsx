import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";

interface CustomFieldRowMenuProps {
  canEdit: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export default function CustomFieldRowMenu({
  canEdit,
  canDelete,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: CustomFieldRowMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          style={{ margin: 0 }}
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
        {canEdit && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            color="red"
            confirmation={{
              submit: onDelete,
              confirmationTitle: "Delete custom field",
              cta: "Delete",
              getConfirmationContent: async () =>
                "Are you sure? This action cannot be undone.",
            }}
          >
            Delete
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canMoveUp}
          onClick={() => {
            if (canMoveUp) {
              onMoveUp();
              setOpen(false);
            }
          }}
        >
          <PiCaretUp /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canMoveDown}
          onClick={() => {
            if (canMoveDown) {
              onMoveDown();
              setOpen(false);
            }
          }}
        >
          <PiCaretDown /> Move down
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
