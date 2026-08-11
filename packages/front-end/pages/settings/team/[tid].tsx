import router from "next/router";
import React, { FC, useState } from "react";
import { date, datetime } from "shared/dates";
import { FaUserLock } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Flex, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { GBAddCircle } from "@/components/Icons";
import TeamModal from "@/components/Teams/TeamModal";
import { AddMembersModal } from "@/components/Teams/AddMembersModal";
import { PermissionsModal } from "@/components/Settings/Teams/PermissionModal";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import PageHead from "@/components/Layout/PageHead";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

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
  const projectName = project?.name || "All Projects";
  const projectIsDeReferenced = team?.defaultProject && !project?.name;

  if (!team) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Team <code>{tid}</code> does not exist.
        </Callout>
      </div>
    );
  }

  const memberCount = team.members ? team.members.length : 0;

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

      <PageHead
        breadcrumb={[
          { display: "Teams", href: "/settings/team#teams" },
          { display: team.name },
        ]}
      />

      <div className="container pagecontents">
        {!isEditable && (
          <Callout status="info" mb="4">
            This team is managed by an idP. To make changes to the{" "}
            <b>team name</b> or <b>team membership</b> please access your idP
            and edit the corresponding group. Team permissions must be edited
            via the <b>Edit Permissions</b> button.
          </Callout>
        )}

        <Flex align="center" justify="between" gap="3" mb="1">
          <Flex align="center" gap="2">
            <Heading as="h1" size="xl" mb="0" overflowWrap="anywhere">
              {team.name}
            </Heading>
            {team.managedBy?.type ? (
              <Badge
                label={`Managed by ${capitalizeFirstLetter(
                  team.managedBy.type,
                )}`}
              />
            ) : null}
          </Flex>
          <Flex align="center" gap="4" flexShrink="0">
            <Button
              variant="outline"
              icon={<FaUserLock />}
              onClick={() => setPermissionModalOpen(true)}
            >
              Edit Permissions
            </Button>
            {isEditable && canManageTeam && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="3"
                    highContrast
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setTeamModalOpen(true)}>
                    Edit team
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            )}
          </Flex>
        </Flex>

        <Text as="p" color="text-mid" mb="4">
          {team.description || <em>No description</em>}
        </Text>

        <Flex align="center" gap="2" mb="5">
          <Text weight="semibold">Default project:</Text>
          {projectIsDeReferenced ? (
            <Tooltip
              body={
                <>
                  Project <code>{team?.defaultProject}</code> not found
                </>
              }
            >
              <Badge label="Invalid project" color="red" />
            </Tooltip>
          ) : (
            <Badge label={projectName} />
          )}
        </Flex>

        <Flex align="center" justify="between" gap="3" mb="2">
          <Heading as="h2" size="md" mb="0">
            Team Members ({memberCount})
          </Heading>
          {isEditable && canManageTeam && (
            <Button
              icon={<GBAddCircle />}
              onClick={() => setMemberModalOpen(true)}
            >
              Add Members
            </Button>
          )}
        </Flex>

        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Email</TableColumnHeader>
              <TableColumnHeader>Date Joined</TableColumnHeader>
              <TableColumnHeader style={{ width: 50 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.members?.map((member) => (
              <TableRow key={member.id}>
                <TableCell>{member.name}</TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell
                  title={
                    member.dateCreated
                      ? datetime(member.dateCreated)
                      : undefined
                  }
                >
                  {member.dateCreated && date(member.dateCreated)}
                </TableCell>
                <TableCell>
                  {canManageTeam && isEditable && (
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                        >
                          <BsThreeDotsVertical size={18} />
                        </IconButton>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          color="red"
                          confirmation={{
                            submit: async () => {
                              await apiCall(
                                `/teams/${team.id}/member/${member.id}`,
                                { method: "DELETE" },
                              );
                              refreshOrganization();
                            },
                            confirmationTitle: `Remove ${member.email}?`,
                            cta: "Remove",
                          }}
                        >
                          Remove from team
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {memberCount === 0 && (
              <TableRow>
                <TableCell colSpan={4} style={{ textAlign: "center" }}>
                  <Text color="text-mid">This team has no members yet.</Text>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export default TeamPage;
