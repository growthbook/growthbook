import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { ProjectInterface } from "shared/types/project";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";

interface ProjectRowMenuProps {
  project: ProjectInterface;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  deleteProjectResources: boolean;
  setDeleteProjectResources: (v: boolean) => void;
}

export default function ProjectRowMenu({
  project,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  deleteProjectResources,
  setDeleteProjectResources,
}: ProjectRowMenuProps) {
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
                <h5 className="modal-title">Delete Project</h5>
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
                  Are you sure you want to delete the project{" "}
                  <strong>{project.name}</strong>?
                </p>
                <Checkbox
                  value={deleteProjectResources}
                  setValue={(v) => setDeleteProjectResources(v)}
                  label="Also delete all of this project's resources"
                  description="Features, experiments, etc."
                />
                {!deleteProjectResources && (
                  <Callout status="warning" mt="3">
                    <strong>Warning:</strong> You may end up with orphaned
                    resources that will need to be cleaned up manually.
                  </Callout>
                )}
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
                    } catch (e) {
                      // Error handling would be done in the parent
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
