import { useState, FC } from "react";
import { useAuth } from "../services/auth";
import Modal from "./Modal";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  currentName: string;
  currentReferenceId: string;
  showReferenceId?: boolean;
}> = ({
  onEdit,
  close,
  id,
  currentName,
  currentReferenceId,
  showReferenceId,
}) => {
  const [name, setName] = useState(currentName);
  const [referenceId, setReferenceId] = useState(currentReferenceId);

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
      orgId?: string;
    }>("/organization", {
      method: "PUT",
      headers: { "X-Organization": id },
      body: JSON.stringify({
        name,
        referenceId,
      }),
    });
    onEdit();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={"Edit Organization"}
      cta={"Edit"}
      close={close}
      inline={!close}
    >
      <div className="form-group">
        Company Name
        <input
          type="text"
          className="form-control"
          value={name}
          required
          minLength={3}
          onChange={(e) => setName(e.target.value)}
        />
        {showReferenceId && (
          <div className="mt-3">
            Reference Id: Id used for the organization within your name
            (optional)
            <input
              type="text"
              className="form-control"
              value={referenceId}
              minLength={3}
              onChange={(e) => setReferenceId(e.target.value)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EditOrganization;
