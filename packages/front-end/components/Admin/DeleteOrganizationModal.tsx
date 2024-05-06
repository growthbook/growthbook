import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

const DeleteOrganization: FC<{
  onDelete: () => void;
  close?: () => void;
  id: string;
  currentName: string;
}> = ({ onDelete, close, id, currentName }) => {
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    try {
      await apiCall<{
        status: number;
        message?: string;
        orgId?: string;
      }>(`/admin/organization/${id}`, {
        method: "DELETE",
      });
      onDelete();
    } catch (e) {
      setError(`There was an error deleting the org: ${e.message}`);
    }
  };

  return (
    <Modal
      error={error}
      submit={handleSubmit}
      open={true}
      header={"Delete Organization"}
      cta={"Delete"}
      close={close}
      ctaEnabled={name === currentName}
    >
      <p>
        Are you <strong>absolutely sure</strong> that you want to delete this
        organization? This data will be lost and will not be recoverable.
      </p>
      <div className="form-group alert alert-danger">
        <p>
          Please type the organization name to confirm:{" "}
          <strong>{currentName}</strong>
        </p>
        <input
          type="text"
          className="form-control"
          value={name}
          required
          minLength={3}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Modal>
  );
};

export default DeleteOrganization;
