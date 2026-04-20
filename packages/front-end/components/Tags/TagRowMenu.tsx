import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

interface TagRowMenuProps {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

export default function TagRowMenu({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: TagRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="2"
            highContrast
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
              onClick={() => {
                setDeleteModalOpen(true);
                setOpen(false);
              }}
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenu>

      {deleteModalOpen && (
        <div
          className="modal fade show"
          style={{ display: "block" }}
          role="dialog"
          onClick={() => !isDeleting && setDeleteModalOpen(false)}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Tag</h5>
                <button
                  type="button"
                  className="close"
                  disabled={isDeleting}
                  onClick={() => setDeleteModalOpen(false)}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure? Deleting a tag will remove it from all features,
                  metrics, and experiments.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isDeleting}
                  onClick={() => setDeleteModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={isDeleting}
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      await onDelete();
                      setDeleteModalOpen(false);
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteModalOpen && <div className="modal-backdrop fade show" />}
    </>
  );
}
