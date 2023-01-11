import React, { FC, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { ExpandedMember } from "back-end/types/organization";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { datetime } from "@/services/dates";
import ProjectBadges from "@/components/ProjectBadges";
import { GBAddCircle } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { usingSSO } from "@/services/env";
import { useEnvironments } from "@/services/features";
import InviteModal from "@/components/Settings/Team/InviteModal";
import AdminSetPasswordModal from "@/components/Settings/Team/AdminSetPasswordModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";

const MemberList: FC<{
  mutate: () => void;
  project: string;
}> = ({ mutate, project }) => {
  const [inviting, setInviting] = useState(false);
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const [roleModal, setRoleModal] = useState<string>("");
  const [passwordResetModal, setPasswordResetModal] = useState<ExpandedMember>(
    null
  );
  const { projects } = useDefinitions();
  const environments = useEnvironments();

  const onInvite = () => {
    setInviting(true);
  };

  const roleModalUser = users.get(roleModal);

  return (
    <div className="my-4">
      <h5>Active Members{` (${users.size})`}</h5>
      {inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {roleModal && roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
          }}
          close={() => setRoleModal(null)}
          onConfirm={async (value) => {
            await apiCall(`/member/${roleModal}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      {passwordResetModal && (
        <AdminSetPasswordModal
          close={() => setPasswordResetModal(null)}
          member={passwordResetModal}
        />
      )}
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Date Joined</th>
            <th>{project ? "Project Role" : "Global Role"}</th>
            {!project && <th>Project Roles</th>}
            {environments.map((env) => (
              <th key={env.id}>{env.id}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {Array.from(users).map(([id, member]) => {
            const roleInfo =
              (project &&
                member.projectRoles?.find((r) => r.project === project)) ||
              member;
            return (
              <tr key={id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.dateCreated && datetime(member.dateCreated)}</td>
                <td>{roleInfo.role}</td>
                {!project && (
                  <td className="col-3">
                    {member.projectRoles.map((pr) => {
                      const p = projects.find((p) => p.id === pr.project);
                      if (p?.name) {
                        return (
                          <div key={`project-tags-${p.id}`}>
                            <ProjectBadges
                              projectIds={[p.id]}
                              className="badge-ellipsis align-middle font-weight-normal"
                            />
                            — {pr.role}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </td>
                )}
                {environments.map((env) => {
                  const access = roleHasAccessToEnv(roleInfo, env.id);
                  return (
                    <td key={env.id}>
                      {access === "N/A" ? (
                        <span className="text-muted">N/A</span>
                      ) : access === "yes" ? (
                        <FaCheck className="text-success" />
                      ) : (
                        <FaTimes className="text-danger" />
                      )}
                    </td>
                  );
                })}
                <td>
                  {member.id !== userId && (
                    <>
                      <MoreMenu>
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setRoleModal(member.id);
                          }}
                        >
                          Edit Role
                        </button>
                        {!usingSSO() && (
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setPasswordResetModal(member);
                            }}
                          >
                            Reset Password
                          </button>
                        )}
                        <DeleteButton
                          link={true}
                          text="Remove User"
                          useIcon={false}
                          className="dropdown-item"
                          displayName={member.email}
                          onClick={async () => {
                            await apiCall(`/member/${member.id}`, {
                              method: "DELETE",
                            });
                            mutate();
                          }}
                        />
                      </MoreMenu>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="btn btn-primary mt-3" onClick={onInvite}>
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <GBAddCircle />
        </span>
        Invite Member
      </button>
    </div>
  );
};

export default MemberList;
