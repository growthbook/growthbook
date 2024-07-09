import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { isCloud } from "@/services/env";
import Toggle from "@/components/Forms/Toggle";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  deletable: boolean;
  currentName: string;
  currentExternalId: string;
  currentLicenseKey: string;
  currentOwner: string;
  currentDomain: string;
  currentAutoApproveMembers: boolean;
}> = ({
  onEdit,
  close,
  id,
  deletable = false,
  currentName,
  currentExternalId,
  currentLicenseKey,
  currentOwner,
  currentDomain,
  currentAutoApproveMembers,
}) => {
  const [name, setName] = useState(currentName);
  const [owner, setOwner] = useState(currentOwner);
  const [externalId, setExternalId] = useState(currentExternalId);
  const [licenseKey, setLicenseKey] = useState(currentLicenseKey);
  const [verifiedDomain, setVerifiedDomain] = useState(currentDomain);
  const [autoApproveMembers, setAutoApproveMembers] = useState(
    currentAutoApproveMembers
  );

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/organization", {
      method: "PUT",
      body: JSON.stringify({
        orgId: id,
        name,
        externalId,
        licenseKey,
        ownerEmail: owner,
        verifiedDomain,
        autoApproveMembers,
      }),
    });
    onEdit();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={"Edit Organization"}
      cta={"Update"}
      close={close}
      inline={!close}
      secondaryCTA={
        deletable ? (
          <div className="flex-grow-1">
            <button
              className="btn btn-danger"
              onClick={(e) => {
                e.preventDefault();
                if (
                  confirm(
                    "Are you sure you want to disable this organization? Users will not be able to use this organization"
                  )
                ) {
                  apiCall<{
                    status: number;
                    message?: string;
                  }>(`/admin/organization`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      orgId: id,
                    }),
                  });
                  onEdit();
                  if (close) close();
                }
              }}
            >
              Disable
            </button>
          </div>
        ) : null
      }
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
        {isCloud() ? (
          <div className="mt-3">
            License Key
            <input
              type="text"
              className="form-control"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </div>
        ) : (
          <div className="mt-3">
            External Id (optional)
            <input
              type="text"
              className="form-control"
              value={externalId}
              minLength={3}
              onChange={(e) => setExternalId(e.target.value)}
            />
            <span className="text-muted small">
              This field can be used to identify the organization within your
              company.
            </span>
          </div>
        )}
        <div className="mt-3">
          Owner Email
          <input
            type="email"
            className="form-control"
            value={owner}
            required
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div className="mt-3">
          Verified Domain
          <input
            type="text"
            className="form-control"
            value={verifiedDomain}
            onChange={(e) => setVerifiedDomain(e.target.value)}
          />
          <span className="text-muted small">
            This is used so new users can auto join this org by matching email
            domain.
          </span>
        </div>
        <div className="mt-3">
          Auto approve members with email domain
          <Toggle
            className="ml-2"
            id="autoApproveMembers"
            value={autoApproveMembers}
            setValue={setAutoApproveMembers}
          />
        </div>
      </div>
    </Modal>
  );
};

export default EditOrganization;
