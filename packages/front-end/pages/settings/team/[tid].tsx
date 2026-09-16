import router from "next/router";
import React, { FC, useState } from "react";
import { date, datetime } from "shared/dates";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { reviewScopesRequiringTeam } from "shared/util";
import { useAuth } from "@/services/auth";
import TeamModal from "@/components/Teams/TeamModal";
import { AddMembersModal } from "@/components/Teams/AddMembersModal";
import { PermissionsModal } from "@/components/Settings/Teams/PermissionModal";
import { RoleRuleLines } from "@/components/Settings/Team/RoleRuleLabel";
import Frame from "@/ui/Frame";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
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

  const { teams, refreshOrganization, settings, organization } = useUser();

  // Which review rules demand this team's sign-off, described by their scope, so
  // the team page answers "what does this team gate?".
  const approvalScopes = reviewScopesRequiringTeam(tid, settings);
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  const scopeLabel = (project: string | null) =>
    project
      ? getProjectById(project)?.name || project
      : approvalScopes.length > 1
        ? "All other Projects"
        : "All Projects";

  const team = teams?.find((team) => team.id === tid);
  // Narrow managers arrive from a Project and can't open the Teams list.
  const crumbProject = getProjectById(
    team?.defaultProject || team?.projectRoles?.[0]?.project || "",
  );
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

  const memberCount = team.members?.length ?? 0;
  // Membership follows the team predicate, so a Project Admin who administers
  // every project a project-scoped team covers can manage its members here.
  const canManageMembers = permissionsUtil.canManageTeamMembership(team);

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
          canManageTeam
            ? { display: "Teams", href: "/settings/team#teams" }
            : {
                display: crumbProject?.name ?? "Projects",
                href: crumbProject
                  ? `/project/${crumbProject.id}`
                  : "/projects",
              },
          { display: team.name },
        ]}
      />

      <div className="container pagecontents">
        {!isEditable && (
          <Callout status="info" mb="4">
            This team is managed by an idP. To make changes to the{" "}
            <b>team name</b> or <b>team membership</b> please access your idP
            and edit the corresponding group. Team permissions must be edited
            via the <b>Edit team permissions</b> button.
          </Callout>
        )}

        <Flex align="center" justify="between" gap="3" mb="1">
          <Flex align="center" gap="2">
            <Heading as="h1" size="xl" mb="0" overflowWrap="anywhere">
              {team.name}
            </Heading>
            {team.managedBy?.type && (
              <Badge
                label={`Managed by ${capitalizeFirstLetter(
                  team.managedBy.type,
                )}`}
              />
            )}
          </Flex>
          <Flex align="center" gap="4" flexShrink="0">
            {isEditable && canManageTeam && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="3"
                    highContrast
                    aria-label="Team actions"
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setTeamModalOpen(true)}>
                    Edit team settings
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
          <Text weight="semibold">Default Project:</Text>
          {projectIsDeReferenced ? (
            <Tooltip
              body={
                <>
                  Project <code>{team.defaultProject}</code> not found
                </>
              }
            >
              <Badge label="Invalid Project" color="red" />
            </Tooltip>
          ) : (
            <Badge label={projectName} />
          )}
        </Flex>

        <Frame px="4" py="4" mb="5">
          <Flex align="start" justify="between" gap="3">
            <Flex direction="column" gap="3">
              <Heading as="h2" size="md" mb="0">
                Permissions
              </Heading>
              <Flex direction="column" gap="2">
                <Flex align="start" gap="3" wrap="wrap">
                  <Box style={{ minWidth: 160 }}>
                    <Text weight="medium">
                      {team.projectRoles?.length
                        ? "All other Projects"
                        : "All Projects"}
                    </Text>
                  </Box>
                  <Box>
                    <RoleRuleLines scope={team} organization={organization} />
                  </Box>
                </Flex>
                {team.projectRoles?.map((rule) => (
                  <Flex key={rule.project} align="start" gap="3" wrap="wrap">
                    <Box style={{ minWidth: 160 }}>
                      <Link href={`/project/${rule.project}`}>
                        {getProjectById(rule.project)?.name || rule.project}
                      </Link>
                    </Box>
                    <Box>
                      <RoleRuleLines scope={rule} organization={organization} />
                    </Box>
                  </Flex>
                ))}
              </Flex>
            </Flex>
            {canManageTeam && (
              <Button
                variant="outline"
                onClick={() => setPermissionModalOpen(true)}
              >
                Edit team permissions
              </Button>
            )}
          </Flex>
          {approvalScopes.length > 0 && (
            <>
              <Separator size="4" my="4" />
              <Flex direction="column" gap="2">
                <Heading as="h2" size="md" mb="0">
                  Required Approver
                </Heading>
                <Text size="sm" color="text-low">
                  Approval rules that need this team&apos;s sign-off, managed in
                  the organization&apos;s Approval Flows.
                </Text>
                {approvalScopes.map((scope) => (
                  <Flex
                    key={scope.project ?? "all"}
                    align="center"
                    gap="2"
                    wrap="wrap"
                  >
                    {canManageOrgSettings ? (
                      <Link
                        href={
                          scope.project
                            ? `/settings?approvalProject=${scope.project}#approval-flow`
                            : "/settings#approval-flow"
                        }
                      >
                        {scopeLabel(scope.project)}
                      </Link>
                    ) : scope.project ? (
                      <Link href={`/project/${scope.project}#approvals`}>
                        {scopeLabel(scope.project)}
                      </Link>
                    ) : (
                      <Text>{scopeLabel(scope.project)}</Text>
                    )}
                    {scope.environments.length > 0 && (
                      <Text color="text-low">
                        · {scope.environments.join(", ")}
                      </Text>
                    )}
                  </Flex>
                ))}
              </Flex>
            </>
          )}
        </Frame>

        <Flex align="center" justify="between" gap="3" mb="2">
          <Heading as="h2" size="md" mb="0">
            Team Members ({memberCount})
          </Heading>
          {isEditable && canManageMembers && (
            <Button onClick={() => setMemberModalOpen(true)}>
              Add members
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
                  {canManageMembers && isEditable && (
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                          aria-label="Member actions"
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
