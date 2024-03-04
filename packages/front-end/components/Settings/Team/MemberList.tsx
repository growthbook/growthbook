import React, { FC, useEffect, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { ExpandedMember } from "back-end/types/organization";
import { datetime } from "shared/dates";
import { RxIdCard } from "react-icons/rx";
import router from "next/router";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
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
import Tooltip from "@/components/Tooltip/Tooltip";

const MemberList: FC<{
  mutate: () => void;
  project: string;
  canEditRoles?: boolean;
  canDeleteMembers?: boolean;
  canInviteMembers?: boolean;
  maxHeight?: number | null;
}> = ({
  mutate,
  project,
  canEditRoles = true,
  canDeleteMembers = true,
  canInviteMembers = true,
  maxHeight = null,
}) => {
  const [inviting, setInviting] = useState(!!router.query["just-subscribed"]);
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const [roleModal, setRoleModal] = useState<string>("");
  const [passwordResetModal, setPasswordResetModal] = useState<ExpandedMember>(
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
    null
  );
  const { projects } = useDefinitions();
  const environments = useEnvironments();

  const openInviteModal = !!router.query["just-subscribed"];

  useEffect(() => {
    setInviting(!!router.query["just-subscribed"]);
  }, [openInviteModal]);

  const onInvite = () => {
    setInviting(true);
  };

  const roleModalUser = users.get(roleModal);

  const members = Array.from(users).sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  );

  return (
    <div className="my-4">
      <h5>Active Members{` (${users.size})`}</h5>
      {canInviteMembers && inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {canEditRoles && roleModal && roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
          }}
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
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
      {canEditRoles && passwordResetModal && (
        <AdminSetPasswordModal
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
          close={() => setPasswordResetModal(null)}
          member={passwordResetModal}
        />
      )}
      {/* @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ maxHeight: number; overflowY: "auto"; } | ... Remove this comment to see the full error message */}
      <div style={maxHeight ? { maxHeight, overflowY: "auto" } : null}>
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
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {members.map(([id, member]) => {
              const roleInfo =
                (project &&
                  member.projectRoles?.find((r) => r.project === project)) ||
                member;
              return (
                <tr key={id}>
                  <td>{member.name}</td>
                  <td>
                    <div className="d-flex align-items-center">
                      {member.managedByIdp ? (
                        <Tooltip
                          className="mr-2"
                          body="This user is managed by an external identity provider."
                        >
                          <RxIdCard className="text-blue" />
                        </Tooltip>
                      ) : null}
                      {member.email}
                    </div>
                  </td>
                  <td>{member.dateCreated && datetime(member.dateCreated)}</td>
                  <td>{roleInfo.role}</td>
                  {!project && (
                    <td className="col-3">
                      {member.projectRoles?.map((pr) => {
                        const p = projects.find((p) => p.id === pr.project);
                        if (p?.name) {
                          return (
                            <div key={`project-tags-${p.id}`}>
                              <ProjectBadges
                                resourceType="member"
                                projectIds={[p.id]}
                                className="badge-ellipsis align-middle font-weight-normal"
                              />{" "}
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
                    {canEditRoles && member.id !== userId && (
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
                          {canDeleteMembers && !usingSSO() && (
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
                          {canDeleteMembers && !member.managedByIdp && (
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
                          )}
                        </MoreMenu>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canInviteMembers && (
        <button className="btn btn-primary mt-3" onClick={onInvite}>
          <span className="h4 pr-2 m-0 d-inline-block align-top">
            <GBAddCircle />
          </span>
          Invite Member
        </button>
      )}
    </div>
  );
};

export default MemberList;
