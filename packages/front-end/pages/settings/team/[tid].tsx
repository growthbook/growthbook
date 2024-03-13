import router from "next/router";
import { FC, useState } from "react";
import { datetime } from "shared/dates";
import Link from "next/link";
import { FaUserLock } from "react-icons/fa";
import { useAuth } from "@front-end/services/auth";
import usePermissions from "@front-end/hooks/usePermissions";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import {
  GBAddCircle,
  GBCircleArrowLeft,
  GBEdit,
} from "@front-end/components/Icons";
import TeamModal from "@front-end/components/Teams/TeamModal";
import { AddMembersModal } from "@front-end/components/Teams/AddMembersModal";
import { PermissionsModal } from "@front-end/components/Settings/Teams/PermissionModal";
import { useUser } from "@front-end/services/UserContext";

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

  const { teams, refreshOrganization } = useUser();

  const team = teams?.find((team) => team.id === tid);
  const isEditable = !team?.managedByIdp;

  if (!team) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Team <code>{tid}</code> does not exist.
        </div>
      </div>
    );
  }

  return (
    <>
      {teamModalOpen && (
        <TeamModal
          existing={team}
          close={() => setTeamModalOpen(false)}
          onSuccess={() => refreshOrganization()}
          managedByIdp={!isEditable}
        />
      )}
      <AddMembersModal
        teamId={tid}
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
      />
      <PermissionsModal
        team={team}
        open={permissionModalOpen}
        onClose={() => setPermissionModalOpen(false)}
        onSuccess={() => refreshOrganization()}
      />
      <div className="container pagecontents">
        <div className="mb-4">
          <Link href="/settings/team#teams">
            <GBCircleArrowLeft />
            Back to all teams
          </Link>
        </div>
        {!isEditable && (
          <div className="alert alert-info">
            This team is managed by an idP. To make changes to the{" "}
            <b>team name</b> or <b>team membership</b> please access your idP
            and edit the corresponding group. Team permissions must be edited
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
                              refreshOrganization();
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
