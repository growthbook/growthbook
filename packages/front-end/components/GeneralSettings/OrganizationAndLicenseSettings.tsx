import { FaPencilAlt } from "react-icons/fa";
import React, { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { FaTriangleExclamation } from "react-icons/fa6";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import { isCloud, isMultiOrg } from "@/services/env";
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
  // 此检查并非绝对必要，因为我们在访问设置页面时会检查权限，但为了保险起见这样做也不错
  const canEdit = permissions.check("organizationSettings");
  const { users } = useUser();
  const ownerEmailExists = !!Array.from(users).find(
    (e) => e[1].email === org.ownerEmail
  );

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
      <div className="bg-white p-3 border">
        <div className="row mb-0">
          <div className="col-sm-3">
            <h4>组织信息</h4>
          </div>
          <div className="col-sm-9">
            <div className="form-group row">
              <div className="col-sm-12">
                <strong>名称：</strong> {org.name}{" "}
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
                className={`col-sm-12 ${!ownerEmailExists ? "text-danger" : ""
                  }`}
                title={
                  !ownerEmailExists
                    ? "组织中不存在所有者的邮箱"
                    : ""
                }
              >
                <strong>所有者：</strong> {org.ownerEmail}{" "}
                {!ownerEmailExists && (
                  <span className="text-danger">
                    <FaTriangleExclamation
                      className="ml-1"
                      title="组织中不存在所有者的邮箱"
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
                  <strong>组织ID：</strong> {org.id}
                </div>
              </div>
            )}
          </div>
        </div>
        {(isCloud() || !isMultiOrg()) && (
          <ShowLicenseInfo showInput={!isCloud()} />
        )}
      </div>
    </>
  );
}