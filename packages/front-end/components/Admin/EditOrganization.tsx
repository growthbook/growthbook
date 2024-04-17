import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { isCloud } from "@/services/env";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  currentName: string;
  currentExternalId: string;
  currentLicenseKey: string;
}> = ({
  onEdit,
  close,
  id,
  currentName,
  currentExternalId,
  currentLicenseKey,
}) => {
  const [name, setName] = useState(currentName);
  const [externalId, setExternalId] = useState(currentExternalId);
  const [licenseKey, setLicenseKey] = useState(currentLicenseKey);

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
      orgId?: string;
      licenseKey?: string;
    }>("/organization", {
      method: "PUT",
      headers: { "X-Organization": id },
      body: JSON.stringify({
        name,
        externalId,
        licenseKey,
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
        {isCloud() && (
          <div className="mt-3">
            License Key
            <input
              type="text"
              className="form-control"
              value={licenseKey}
              minLength={3}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </div>
        )}
        {!isCloud() && (
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
