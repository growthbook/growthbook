import router from "next/router";
import { FC, useState } from "react";
import { TeamInterface } from "back-end/types/team";
import { datetime } from "shared/dates";
import Link from "next/link";
import { MemberRoleWithProjects } from "back-end/types/organization";
import { FaUserLock } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import RoleSelector from "@/components/Settings/Team/RoleSelector";
import TeamModal from "@/components/Teams/TeamModal";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import { AddMembersModal } from "@/components/Teams/AddMembersModal";

const TeamPage: FC = () => {
  const { apiCall } = useAuth();
  const { tid } = router.query as { tid: string };
  const [teamModalOpen, setTeamModalOpen] = useState<boolean>(false);
  const [permissionModalOpen, setPermissionModalOpen] = useState<boolean>(
    false
  );
  const [memberModalOpen, setMemberModalOpen] = useState<boolean>(false);

  const permissions = usePermissions();
  const canManageTeam = permissions.check("manageTeam");

  const { data, mutate } = useApi<{
    team: TeamInterface;
  }>(`/teams/${tid}`);

  if (!data) {
    return <LoadingOverlay />;
  }

  const { team } = data;
  const isEditable = !team.managedByIdp;

  const PermissionsModal = () => {
    const form = useForm<{
      roleInfo: MemberRoleWithProjects;
    }>({
      defaultValues: {
        roleInfo: {
          role: team.role,
          limitAccessByEnvironment: team.limitAccessByEnvironment,
          environments: team.environments,
          projectRoles: team.projectRoles || [],
        },
      },
    });
    const { apiCall } = useAuth();

    return (
      <Modal
        open={permissionModalOpen}
        close={() => setPermissionModalOpen(false)}
        header={"Edit Team Permissions"}
        submit={form.handleSubmit(async (value) => {
          await apiCall(`/teams/${team.id}`, {
            method: "PUT",
            body: JSON.stringify({
              permissions: { ...value.roleInfo },
            }),
          });
          mutate();
        })}
      >
        <RoleSelector
          value={form.watch("roleInfo")}
          setValue={(value) => form.setValue("roleInfo", value)}
        />
      </Modal>
    );
  };

  return (
    <>
      {teamModalOpen && (
        <TeamModal
          existing={team}
          close={() => setTeamModalOpen(false)}
          onSuccess={() => mutate()}
          managedByIdp={!isEditable}
        />
      )}
      <AddMembersModal
        teamId={tid}
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
      />
      <PermissionsModal />
      <div className="container pagecontents">
        <div className="mb-4">
          <Link href="/settings/team#teams">
            <a>
              <GBCircleArrowLeft /> Back to all teams
            </a>
          </Link>
        </div>
        {!isEditable && (
          <div className="alert alert-info">
            This team is managed by Okta. To make changes to the{" "}
            <b>team name</b> or <b>team membership</b> please visit Okta and
            edit the corresponding Okta group. Team permissions must be edited
            via the <b>Edit Permissions</b> button below.
          </div>
        )}
        <div className="d-flex align-items-center mb-2">
          <h1 className="mb-0">{team.name}</h1>
          {isEditable && (
            <div className="ml-1">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTeamModalOpen(true);
                }}
              >
                <GBEdit />
              </a>
            </div>
          )}
          <div className="ml-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setPermissionModalOpen(true);
              }}
            >
              <FaUserLock /> <span> </span>Edit Permissions
            </button>
          </div>
        </div>
        <div className="d-flex align-items-center mb-2">
          <div className="text-gray">
            {team.description || <em>add description</em>}
          </div>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setTeamModalOpen(true);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <div className="d-flex align-center">
          <h2 className="mt-4 mb-4 mr-2">Team Members</h2>
          {isEditable && (
            <span
              className="h4 pr-2 align-self-center"
              role="button"
              onClick={() => setMemberModalOpen(true)}
            >
              <GBAddCircle />
            </span>
          )}
        </div>

        <div className="mb-4">
          <h5>
            Active Members
            {` (${team.members ? team.members.length : 0})`}
          </h5>
          <table className="table appbox gbtable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Date Joined</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {team.members?.map((member) => {
                return (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>
                      {member.dateCreated && datetime(member.dateCreated)}
                    </td>
                    <td>
                      {canManageTeam && isEditable && (
                        <>
                          <DeleteButton
                            link={true}
                            useIcon={true}
                            displayName={member.email}
                            onClick={async () => {
                              await apiCall(
                                `/teams/${team.id}/member/${member.id}`,
                                {
                                  method: "DELETE",
                                }
                              );
                              mutate();
                            }}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default TeamPage;
