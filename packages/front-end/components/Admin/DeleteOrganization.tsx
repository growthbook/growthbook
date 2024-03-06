import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

const DeleteOrganization: FC<{
  onDelete: () => void;
  close?: () => void;
  id: string;
  currentName: string;
}> = ({ onDelete, close, id, currentName }) => {
  const [name, setName] = useState("");

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
      orgId?: string;
    }>("/admin/organization", {
      method: "DELETE",
      headers: { "X-Organization": id },
    });
    onDelete();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={"Delete Organization"}
      cta={"Delete"}
      close={close}
      inline={!close}
      ctaEnabled={name === currentName}
    >
      <p>
        Are you <strong>absolutely sure</strong> that you want to delete this
        organization? This data will be lost and will not be recoverable.
      </p>
      <p>To confirm, please type the name of the organization below.</p>
      <div className="form-group alert alert-danger">
        <p>
          I fully intend to delete the organization:{" "}
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
