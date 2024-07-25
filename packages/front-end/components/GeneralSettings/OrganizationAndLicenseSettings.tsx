import { FaPencilAlt } from "react-icons/fa";
import React, { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { FaTriangleExclamation } from "react-icons/fa6";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import { getGrowthBookBuild, isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";

export default function OrganizationAndLicenseSettings({
  org,
  refreshOrg,
}: {
  org: Partial<OrganizationInterface>;
  refreshOrg: () => Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const permissions = usePermissions();
  // this check isn't strictly necessary, as we check permissions accessing the settings page, but it's a good to be safe
  const canEdit = permissions.check("organizationSettings");
  const { users } = useUser();
  const ownerEmailExists = !!Array.from(users).find(
    (e) => e[1].email === org.ownerEmail
  );
  const build = getGrowthBookBuild();

  return (
    <>
      {editOpen && (
        <EditOrganizationModal
          name={org.name || ""}
          ownerEmail={org.ownerEmail || ""}
          close={() => setEditOpen(false)}
          mutate={refreshOrg}
        />
      )}
      <div className=" bg-white p-3 border">
        <div className="row mb-0">
          <div className="col-sm-3">
            <h4>Organization</h4>
          </div>
          <div className="col-sm-9">
            <div className="form-group row">
              <div className="col-sm-12">
                <strong>Name: </strong> {org.name}{" "}
                {canEdit && (
                  <a
                    href="#"
                    className="pl-1"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditOpen(true);
                    }}
                  >
                    <FaPencilAlt />
                  </a>
                )}
              </div>
            </div>
            <div className="form-group row">
              <div
                className={`col-sm-12 ${
                  !ownerEmailExists ? "text-danger" : ""
                }`}
                title={
                  !ownerEmailExists
                    ? "Owner email does not exist in the organization"
                    : ""
                }
              >
                <strong>Owner:</strong> {org.ownerEmail}{" "}
                {!ownerEmailExists && (
                  <span className="text-danger">
                    <FaTriangleExclamation
                      className=" ml-1"
                      title="Owner email does not exist in the organization"
                      style={{ marginTop: -3 }}
                    />
                  </span>
                )}
                {canEdit && (
                  <a
                    href="#"
                    className="pl-1"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditOpen(true);
                    }}
                  >
                    <FaPencilAlt />
                  </a>
                )}
              </div>
            </div>
            {!isCloud() && !isMultiOrg() && (
              <div className="form-group row">
                <div className="col-sm-12">
                  <strong>Organization Id:</strong> {org.id}
                </div>
              </div>
            )}
          </div>
        </div>
        {(!isCloud() || !isMultiOrg()) && (
          <ShowLicenseInfo showInput={!isCloud()} />
        )}
        {!isCloud() && (
          <div>
            <div className="divider border-bottom mb-3 mt-3" />
            <div className="row">
              <div className="col-sm-3">
                <h4>Version</h4>
              </div>
              <div className="col-sm-9">
                <div className="col-sm-12">
                  <button
                    className="alert alert-warning py-1 px-2 mb-3 d-none d-md-block mr-1"
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                  >
                    Update to{" "}
                    <span style={{ textDecoration: "underline" }}>
                      GrowthBook 3.1
                    </span>
                  </button>
                  <span style={{ fontWeight: 500 }}>v3.0</span>
                </div>
                {build.sha && (
                  <div
                    className="col-sm-12 mt-2"
                    style={{ fontSize: "13px", fontWeight: 500 }}
                  >
                    <span>Build:</span>{" "}
                    <a
                      href={`https://github.com/growthbook/growthbook/commit/${build.sha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-white"
                    >
                      {build.sha.substr(0, 7)}
                    </a>{" "}
                    {build.date && <span>({build.date.substr(0, 10)})</span>}
                  </div>
                )}
                <div className="col-sm-12 mt-2">
                  <a href="#">View all product releases</a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
