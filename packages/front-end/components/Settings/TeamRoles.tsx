import { Permission, Permissions } from "back-end/types/permissions";
import { useState } from "react";
import DeleteButton from "../DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import { GBAddCircle } from "../Icons";
import RoleModal from "./RoleModal";
import { MemberInfo } from "./MemberList";
import { useAuth } from "../../services/auth";
import { Roles } from "back-end/types/organization";
import Modal from "../Modal";
import {
  getEnvFromPermission,
  isEnvPermission,
  PERMISSIONS,
} from "../../hooks/usePermissions";
import CheckBoxField from "../Forms/CheckBoxField";

interface TeamRolesProps {
  roles: Roles;
  members: MemberInfo[];
  mutate: () => void;
}

export interface FormRole {
  id: string;
  description: string;
  permissions: Permissions;
  members: MemberInfo[];
}

export default function TeamRoles({ roles, members, mutate }: TeamRolesProps) {
  const { apiCall } = useAuth();
  const [showViewModal, setShowViewModal] = useState(false);
  const [activeRole, setActiveRole] = useState<FormRole | null>(null);

  const [modalType, setModalType] = useState<"create" | "update" | null>(null);
  const closeModal = () => {
    setActiveRole(null);
    setModalType(null);
  };

  return (
    <>
      {modalType && activeRole && (
        <RoleModal
          type={modalType}
          role={activeRole}
          close={closeModal}
          mutate={mutate}
        />
      )}
      {showViewModal && activeRole && (
        <Modal
          close={() => {
            setShowViewModal(false);
            setActiveRole(null);
          }}
          header={`Viewing ${activeRole.id}`}
          open={true}
          autoCloseOnSubmit={false}
          cta={""}
          closeCta={"Close"}
        >
          <div className="mb-3">
            <strong>Description:</strong> {activeRole.description}
          </div>
          {Object.keys(PERMISSIONS).map((p) => {
            let envName = "";
            if (isEnvPermission(p)) envName = getEnvFromPermission(p);

            return (
              <>
                {PERMISSIONS[p]?.title && <h4>{PERMISSIONS[p].title}</h4>}
                <CheckBoxField
                  key={p}
                  id={`role-${p}`}
                  tooltip={PERMISSIONS[p]?.description || ""}
                  label={
                    isEnvPermission(p) ? envName : PERMISSIONS[p]?.displayName
                  }
                  labelClassName="mx-2"
                  containerClassName={`my-1 ${
                    isEnvPermission(p) ? "ml-4" : ""
                  }`}
                  disabled
                  checked={activeRole.permissions.includes(p as Permission)}
                />
              </>
            );
          })}
        </Modal>
      )}
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th>Role</th>
            <th>Description</th>
            <th>Members</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(roles)
            .sort(
              ([, roleA], [, roleB]) =>
                roleA.permissions.length - roleB.permissions.length
            )
            .map(([role, { permissions, description }]) => {
              const roleMembers = members.filter(
                (member) => member.role === role
              );
              return (
                <tr key={role} className="py-2">
                  <td>{role}</td>
                  <td>{description}</td>
                  <td>{roleMembers.map((member) => member.name).join(", ")}</td>
                  <td>
                    <div className="tr-hover actions">
                      <MoreMenu id="teamRoles">
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveRole({
                              id: role,
                              description: description,
                              permissions: permissions,
                              members: roleMembers,
                            });
                            setShowViewModal(true);
                          }}
                        >
                          View Role
                        </button>
                        {role !== "admin" && (
                          <>
                            <button
                              className="dropdown-item"
                              onClick={(e) => {
                                e.preventDefault();
                                setActiveRole({
                                  id: role,
                                  description: description,
                                  permissions: permissions,
                                  members: roleMembers,
                                });
                                setModalType("update");
                              }}
                            >
                              Edit Role
                            </button>
                            <DeleteButton
                              link={true}
                              text="Delete Role"
                              useIcon={false}
                              className="dropdown-item"
                              displayName={role}
                              onClick={async () => {
                                await apiCall(`/roles/${role}`, {
                                  method: "DELETE",
                                  credentials: "include",
                                });
                                mutate();
                              }}
                            />
                          </>
                        )}
                      </MoreMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      <button
        className="btn btn-primary mt-3"
        onClick={(e) => {
          e.preventDefault();
          setActiveRole({
            id: "",
            description: "",
            permissions: [],
            members: [],
          });
          setModalType("create");
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <GBAddCircle />
        </span>
        Create Role
      </button>
    </>
  );
}
