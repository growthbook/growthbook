import { FC, useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

const DeleteOrganizationModal: FC<{
  close: () => void;
  orgName: string;
}> = ({ close, orgName }) => {
  const { apiCall, logout } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfirmed = confirmText.trim() === "Delete";

  const handleDelete = async () => {
    if (!isConfirmed) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiCall("/organization", {
        method: "DELETE",
      });

      // Organization is deleted, log out the user
      await logout();
    } catch (e) {
      setError(e.message || "Failed to delete organization");
      setLoading(false);
    }
  };

  return (
    <Modal
      trackingEventModalType=""
      header="Delete Organization"
      open={true}
      close={close}
      submit={handleDelete}
      cta="Delete Organization"
      ctaEnabled={isConfirmed && !loading}
      submitColor="danger"
      error={error || undefined}
      loading={loading}
    >
      <div className="alert alert-danger">
        <strong>Warning:</strong> This action cannot be undone. Deleting your
        organization will immediately delete it and you will be logged out.
      </div>
      <p>
        All data associated with <strong>{orgName}</strong> will be deleted.
        This includes:
      </p>
      <ul>
        <li>All features and experiments</li>
        <li>All metrics and data sources</li>
        <li>All team members and settings</li>
      </ul>
      <p>
        <strong>
          All other members of this organization will also immediately lose
          access.
        </strong>
      </p>
      <Field
        label="Type 'Delete' to confirm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="Delete"
        autoFocus
      />
    </Modal>
  );
};

export default DeleteOrganizationModal;
