import { Permissions } from "back-end/types/permissions";
import { useState } from "react";
import DeleteButton from "../DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import { GBAddCircle } from "../Icons";
import RoleModal from "./RoleModal";
import { MemberInfo } from "./MemberList";
import { useAuth } from "../../services/auth";

interface TeamRolesProps {
  roles: Record<string, Permissions>;
  members: MemberInfo[];
  mutate: () => void;
}

export default function TeamRoles({ roles, members, mutate }: TeamRolesProps) {
  const { apiCall } = useAuth();
  const [activeRole, setActiveRole] = useState<{
    name: string;
    rolePermissions: Permissions;
    members: MemberInfo[];
  } | null>(null);

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
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th>Role</th>
            <th>Permissions</th>
            <th>Members</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(roles)
            .sort(
              ([, aPermissions], [, bPermissions]) =>
                aPermissions.length - bPermissions.length
            )
            .map(([role, permissions]) => {
              const roleMembers = members.filter(
                (member) => member.role === role
              );
              return (
                <tr key={role} className="py-2">
                  <td>{role}</td>
                  <td>{permissions.join(", ")}</td>
                  <td>{roleMembers.map((member) => member.name).join(", ")}</td>
                  <td>
                    <div className="tr-hover actions">
                      <MoreMenu id="teamRoles">
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveRole({
                              name: role,
                              rolePermissions: permissions,
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
            name: "",
            rolePermissions: [],
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
