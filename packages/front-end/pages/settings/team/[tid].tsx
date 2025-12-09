import router from "next/router";
import React, { FC, useState } from "react";
import { datetime } from "shared/dates";
import Link from "next/link";
import { FaExclamationTriangle, FaUserLock } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import TeamModal from "@/components/Teams/TeamModal";
import { AddMembersModal } from "@/components/Teams/AddMembersModal";
import { PermissionsModal } from "@/components/Settings/Teams/PermissionModal";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const TeamPage: FC = () => {
  const { apiCall } = useAuth();
  const { getProjectById } = useDefinitions();
  const { tid } = router.query as { tid: string };
  const [teamModalOpen, setTeamModalOpen] = useState<boolean>(false);
  const [permissionModalOpen, setPermissionModalOpen] =
    useState<boolean>(false);
  const [memberModalOpen, setMemberModalOpen] = useState<boolean>(false);

  const permissionsUtil = usePermissionsUtil();
  const canManageTeam = permissionsUtil.canManageTeam();

  const { teams, refreshOrganization } = useUser();

  const team = teams?.find((team) => team.id === tid);
  const isEditable = !team?.managedByIdp;

  const project = getProjectById(team?.defaultProject || "");
  const projectName = project?.name || "All projects";
  const projectIsDeReferenced = team?.defaultProject && !project?.name;

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
            <GBCircleArrowLeft className="mr-1" />
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
        {team.managedBy?.type ? (
          <div>
            <Badge
              label={`Managed by ${capitalizeFirstLetter(team.managedBy.type)}`}
            />
          </div>
        ) : null}
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

        <div className="mt-4">
          <div className="form-group">
            <label className="font-weight-bold text-dark">
              Default Project
            </label>
            <Box>
              {projectIsDeReferenced ? (
                <Tooltip
                  body={
                    <>
                      Project <code>{team?.defaultProject}</code> not found
                    </>
                  }
                >
                  <span className="text-danger">
                    <FaExclamationTriangle /> Invalid project
                  </span>
                </Tooltip>
              ) : (
                <Badge label={projectName} />
              )}
              {isEditable && (
                <a
                  className="ml-2"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setTeamModalOpen(true);
                  }}
                >
                  <GBEdit />
                </a>
              )}
            </Box>
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
          <Table className="appbox gbtable">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Name</TableColumnHeader>
                <TableColumnHeader>Email</TableColumnHeader>
                <TableColumnHeader>Date Joined</TableColumnHeader>
                <TableColumnHeader style={{ width: 50 }}></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members?.map((member) => {
                return (
                  <TableRow key={member.id}>
                    <TableCell>{member.name}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      {member.dateCreated && datetime(member.dateCreated)}
                    </TableCell>
                    <TableCell>
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
                                },
                              );
                              refreshOrganization();
                            }}
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
};

export default TeamPage;
