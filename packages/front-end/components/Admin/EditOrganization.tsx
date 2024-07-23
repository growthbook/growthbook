import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { isCloud } from "@/services/env";
import Toggle from "@/components/Forms/Toggle";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  disablable: boolean;
  currentDisabled: boolean;
  currentName: string;
  currentExternalId: string;
  currentLicenseKey: string;
  currentOwner: string;
  currentDomain: string;
  currentAutoApproveMembers: boolean;
  currentLegacyEnterprise: boolean;
  currentFreeSeats: number;
}> = ({
  onEdit,
  close,
  id,
  disablable = true,
  currentDisabled = false,
  currentName,
  currentExternalId,
  currentLicenseKey,
  currentOwner,
  currentDomain,
  currentAutoApproveMembers,
  currentLegacyEnterprise,
  currentFreeSeats,
}) => {
  const [name, setName] = useState(currentName);
  const [owner, setOwner] = useState(currentOwner);
  const [externalId, setExternalId] = useState(currentExternalId);
  const [licenseKey, setLicenseKey] = useState(currentLicenseKey);
  const [freeSeats, setFreeSeats] = useState(currentFreeSeats);
  const [legacyEnterprise, setLegacyEnterprise] = useState(
    currentLegacyEnterprise
  );
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
        enterprise: legacyEnterprise,
        freeSeats,
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
        disablable ? (
          <div className="flex-grow-1">
            {currentDisabled ? (
              <button
                className="btn btn-info"
                onClick={(e) => {
                  e.preventDefault();
                  apiCall<{
                    status: number;
                    message?: string;
                  }>(`/admin/organization/enable`, {
                    method: "PUT",
                    body: JSON.stringify({
                      orgId: id,
                    }),
                  });
                  onEdit();
                  if (close) close();
                }}
              >
                Enable
              </button>
            ) : (
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
                    }>(`/admin/organization/disable`, {
                      method: "PUT",
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
            )}
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
        {isCloud() ? (
          <>
            <div className="mt-3">
              Free Seats
              <input
                type="number"
                min={0}
                className="form-control"
                value={freeSeats}
                onChange={(e) => setFreeSeats(parseInt(e.target.value))}
              />
              <div>
                <span className="text-muted small">
                  Number of seats that will not be billed
                </span>
              </div>
            </div>
            <div className="mt-3">
              Enable Enterprise
              <Toggle
                className="ml-2"
                id="legacyEnterpriseToggle"
                value={legacyEnterprise}
                setValue={setLegacyEnterprise}
              />
              <div>
                <span className="text-muted small">
                  Organizations with enterprise enabled this way are not billed,
                  and will not expire. This is a legacy feature. Be sure to also
                  adjust the free seats to match org requirements.
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default EditOrganization;
