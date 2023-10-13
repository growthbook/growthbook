import { useState, FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";

const CreateOrganization: FC<{
  onCreate: () => void;
  close?: () => void;
  showReferenceId?: boolean;
}> = ({ onCreate, close, showReferenceId }) => {
  const [company, setCompany] = useState("");
  const [referenceId, setReferenceId] = useState("");

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
      orgId?: string;
    }>("/organization", {
      method: "POST",
      body: JSON.stringify({
        company,
        referenceId,
      }),
    });
    onCreate();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={"Create New Organization"}
      cta={"Create"}
      close={close}
      inline={!close}
    >
      <div className="form-group">
        Company Name
        <input
          type="text"
          className="form-control"
          value={company}
          required
          minLength={3}
          onChange={(e) => setCompany(e.target.value)}
        />
        {showReferenceId && (
          <div className="mt-3">
            Reference Id: Id used for the organization within your company
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

export default CreateOrganization;
