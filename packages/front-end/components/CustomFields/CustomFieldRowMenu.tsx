import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { CustomFieldSection } from "shared/types/custom-fields";
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
  isActive: boolean;
  sections: CustomFieldSection[] | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
}

// Only the sections a field targets can hold values for it.
function deleteConfirmation(
  sections: CustomFieldSection[] | undefined,
): string {
  const scopes = [
    ...(sections?.includes("feature") ? ["Feature Flags"] : []),
    ...(sections?.includes("experiment") ? ["experiments"] : []),
  ];
  if (!scopes.length) return "Are you sure? This action cannot be undone.";
  return `Are you sure? Any values saved for this field on ${scopes.join(
    " and ",
  )} will be removed too. This action cannot be undone.`;
}

export default function CustomFieldRowMenu({
  canEdit,
  canDelete,
  canMoveUp,
  canMoveDown,
  isActive,
  sections,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleActive,
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
              getConfirmationContent: async () => deleteConfirmation(sections),
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
