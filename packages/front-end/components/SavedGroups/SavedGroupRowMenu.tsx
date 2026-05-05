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
}

export default function SavedGroupRowMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: SavedGroupRowMenuProps) {
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
        {canDelete && (
          <DropdownMenuItem
            color="red"
            onClick={() => {
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
