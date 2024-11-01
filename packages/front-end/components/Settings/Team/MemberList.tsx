import React, { FC, useEffect, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { ExpandedMember } from "back-end/types/organization";
import { date, datetime } from "shared/dates";
import { RxIdCard } from "react-icons/rx";
import router from "next/router";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { usingSSO } from "@/services/env";
import { useEnvironments } from "@/services/features";
import InviteModal from "@/components/Settings/Team/InviteModal";
import AdminSetPasswordModal from "@/components/Settings/Team/AdminSetPasswordModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import Button from "@/components/Radix/Button";

const MemberList: FC<{
  mutate: () => void;
  project: string;
  canEditRoles?: boolean;
  canDeleteMembers?: boolean;
  canInviteMembers?: boolean;
}> = ({
  mutate,
  project,
  canEditRoles = true,
  canDeleteMembers = true,
  canInviteMembers = true,
}) => {
  const [inviting, setInviting] = useState(!!router.query["just-subscribed"]);
  const { apiCall } = useAuth();
  const { userId, users, organization } = useUser();
  const [roleModal, setRoleModal] = useState<string>("");
  const [
    passwordResetModal,
    setPasswordResetModal,
  ] = useState<ExpandedMember | null>(null);
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

  const membersList: ExpandedMember[] =
    members.map(([, member]) => {
      return {
        ...member,
        numTeams: member.teams?.length || 0,
      } as ExpandedMember;
    }) || [];

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    pagination,
  } = useSearch({
    items: membersList || [],
    localStorageKey: "members",
    defaultSortField: "name",
    searchFields: ["name", "email"],
    pageSize: 20,
  });
  return (
    <>
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
          close={() => setPasswordResetModal(null)}
          member={passwordResetModal}
        />
      )}

      <div className="my-4">
        <div className="d-flex align-items-end mt-4 mb-2">
          <div>
            <h5>Active Members{` (${users.size})`}</h5>
          </div>
          <div className="ml-3">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
          <div className="flex-1" />
          <div>
            {canInviteMembers && (
              <Button mb="1" onClick={onInvite}>
                Invite Member
              </Button>
            )}
          </div>
        </div>
        <table className="table appbox gbtable">
          <thead>
            <tr>
              <SortableTH field="name">Name</SortableTH>
              <SortableTH field="email">Email</SortableTH>
              <SortableTH field="dateCreated">Date Joined</SortableTH>
              <SortableTH field="lastLoginDate">Last Login</SortableTH>
              <th>{project ? "Project Role" : "Global Role"}</th>
              {!project && <th>Project Roles</th>}
              {environments.map((env) => (
                <th key={env.id}>{env.id}</th>
              ))}
              <SortableTH field="numTeams">Teams</SortableTH>
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((member) => {
              const roleInfo =
                (project &&
                  member.projectRoles?.find((r) => r.project === project)) ||
                member;
              return (
                <tr key={member.id}>
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
                  <td>{member.lastLoginDate && date(member.lastLoginDate)}</td>
                  <td>{roleInfo.role}</td>
                  {!project && (
                    <td className="col-2">
                      {member.projectRoles?.map((pr) => {
                        const p = projects.find((p) => p.id === pr.project);
                        if (p?.name) {
                          return (
                            <div key={`project-tags-${p.id}`}>
                              <ProjectBadges
                                resourceType="member"
                                projectIds={[p.id]}
                                className="badge-ellipsis short align-middle font-weight-normal"
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
                    const access = roleHasAccessToEnv(
                      roleInfo,
                      env.id,
                      organization
                    );
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

                  <td>{member.teams ? member.teams.length : 0}</td>

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
            {!items.length && isFiltered && (
              <tr>
                <td colSpan={4} align={"center"}>
                  No matching members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pagination}
      </div>
    </>
  );
};

export default MemberList;
