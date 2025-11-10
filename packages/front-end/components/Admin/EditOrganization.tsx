import { useState, FC } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { isCloud } from "@/services/env";
import Checkbox from "@/ui/Checkbox";

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  disablable: boolean;
  currentOrg: OrganizationInterface;
}> = ({ onEdit, close, id, disablable = true, currentOrg }) => {
  const [name, setName] = useState(currentOrg.name);
  const [owner, setOwner] = useState(currentOrg.ownerEmail);
  const [externalId, setExternalId] = useState(currentOrg.externalId || "");
  const [licenseKey, setLicenseKey] = useState(currentOrg.licenseKey || "");
  const [freeSeats, setFreeSeats] = useState(currentOrg.freeSeats || 3);
  const [legacyEnterprise, setLegacyEnterprise] = useState(
    currentOrg.enterprise || false,
  );
  const [verifiedDomain, setVerifiedDomain] = useState(
    currentOrg.verifiedDomain || "",
  );
  const [autoApproveMembers, setAutoApproveMembers] = useState(
    currentOrg.autoApproveMembers || false,
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
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header={"Edit Organization"}
      cta={"Update"}
      close={close}
      inline={!close}
      secondaryCTA={
        disablable ? (
          <div className="flex-grow-1">
            {currentOrg.disabled ? (
              <button
                className="btn btn-info"
                onClick={async (e) => {
                  e.preventDefault();
                  await apiCall<{
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
                onClick={async (e) => {
                  e.preventDefault();
                  if (
                    confirm(
                      "Are you sure you want to disable this organization? Users will not be able to use this organization",
                    )
                  ) {
                    await apiCall<{
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
          <Checkbox
            id="autoApproveMembers"
            label="Auto approve members with email domain"
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
                  Number of seats that can be added when on a free plan (3 is
                  the default)
                </span>
              </div>
            </div>
            <div className="p-2 border mt-3">
              <div>
                <b>Deprecated:</b>
                <div className="small">
                  This is an old way to enable enterprise features for an
                  organization, which does not expire, and does not restrict not
                  restrict seats. Please uncheck this and instead user Retool
                  and set a licenseKey instead.
                </div>
              </div>
              <div className="mt-3">
                <Checkbox
                  id="legacyEnterpriseToggle"
                  label="Enable Enterprise"
                  value={legacyEnterprise}
                  setValue={setLegacyEnterprise}
                />
                <div>
                  <span className="text-muted small">
                    Organizations with enterprise enabled this way are not
                    billed, and will not expire.
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default EditOrganization;
