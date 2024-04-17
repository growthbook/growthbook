import { FaPencilAlt } from "react-icons/fa";
import { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import { isCloud, isMultiOrg } from "@/services/env";

export default function OrganizationAndLicenseSettings({
  org,
  refreshOrg,
}: {
  org: Partial<OrganizationInterface>;
  refreshOrg: () => Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      {editOpen && (
        <EditOrganizationModal
          name={org.name || ""}
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
              </div>
            </div>
            <div className="form-group row">
              <div className="col-sm-12">
                <strong>Owner:</strong> {org.ownerEmail}
              </div>
            </div>
          </div>
        </div>
        {(isCloud() || !isMultiOrg()) && (
          <ShowLicenseInfo showInput={!isCloud()} />
        )}
      </div>
    </>
  );
}
