import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  currentName: string;
  currentExternalId: string;
  showExternalId?: boolean;
}> = ({
  onEdit,
  close,
  id,
  currentName,
  currentExternalId,
  showExternalId,
}) => {
  const [name, setName] = useState(currentName);
  const [externalId, setExternalId] = useState(currentExternalId);

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
        externalId,
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
        {showExternalId && (
          <div className="mt-3">
            External Id: Id used for the organization within your company
            (optional)
            <input
              type="text"
              className="form-control"
              value={externalId}
              minLength={3}
              onChange={(e) => setExternalId(e.target.value)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EditOrganization;
