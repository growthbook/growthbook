import { useState } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  RowMenuTrigger,
} from "@/ui/DropdownMenu";

interface CustomFieldRowMenuProps {
  name: string;
  canEdit: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
}

export default function CustomFieldRowMenu({
  name,
  canEdit,
  canDelete,
  canMoveUp,
  canMoveDown,
  isActive,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleActive,
}: CustomFieldRowMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      trigger={<RowMenuTrigger label={`Actions for ${name}`} />}
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
        {canEdit && (
          <DropdownMenuItem
            onClick={() => {
              onToggleActive();
              setOpen(false);
            }}
          >
            {isActive ? "Disable" : "Enable"}
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
