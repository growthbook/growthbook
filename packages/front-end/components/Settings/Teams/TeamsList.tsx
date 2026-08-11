import React, { FC } from "react";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import { FaCheck, FaTimes } from "react-icons/fa";
import { RxIdCard } from "react-icons/rx";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, IconButton } from "@radix-ui/themes";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
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

const TeamsList: FC = () => {
  const { teams, refreshOrganization, organization } = useUser();
  const { projects } = useDefinitions();
  const router = useRouter();
  const environments = useEnvironments();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canManageTeam = permissionsUtil.canManageTeam();

  return (
    <Box mb="4">
      {teams && teams.length > 0 ? (
        <Box style={{ overflowX: "auto" }}>
          <Table variant="list" stickyHeader={false} roundedCorners>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Team Name</TableColumnHeader>
                <TableColumnHeader>Description</TableColumnHeader>
                <TableColumnHeader>Date Updated</TableColumnHeader>
                <TableColumnHeader>Global Role</TableColumnHeader>
                <TableColumnHeader>Project Roles</TableColumnHeader>
                {environments.map((env) => (
                  <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
                ))}
                <TableColumnHeader>Members</TableColumnHeader>
                <TableColumnHeader style={{ width: 50 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => {
                const teamIsExternallyManaged =
                  t.managedBy?.type || t.managedByIdp;
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => {
                      router.push(`/settings/team/${t.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Link href={`/settings/team/${t.id}`}>{t.name}</Link>
                      {t.managedBy?.type ? (
                        <div>
                          <Badge
                            label={`Managed by ${capitalizeFirstLetter(
                              t.managedBy.type,
                            )}`}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-gray" style={{ fontSize: 12 }}>
                      {t.description}
                    </TableCell>
                    <TableCell>{date(t.dateUpdated)}</TableCell>
                    <TableCell>{t.role}</TableCell>
                    <TableCell>
                      {t.projectRoles &&
                        t.projectRoles.map((pr) => {
                          const p = projects.find((p) => p.id === pr.project);
                          if (p?.name) {
                            return (
                              <div key={`project-tags-${p.id}`}>
                                <ProjectBadges
                                  resourceType="team"
                                  projectIds={[p.id]}
                                />{" "}
                                — {pr.role}
                              </div>
                            );
                          }
                          return null;
                        })}
                    </TableCell>
                    {environments.map((env) => {
                      const access = roleHasAccessToEnv(
                        t,
                        env.id,
                        organization,
                      );
                      return (
                        <TableCell key={env.id}>
                          {access === "N/A" ? (
                            <span className="text-muted">N/A</span>
                          ) : access === "yes" ? (
                            <FaCheck className="text-success" />
                          ) : (
                            <FaTimes className="text-danger" />
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell>{t.members ? t.members.length : 0}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {(canManageTeam && !teamIsExternallyManaged && (
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
                                  await apiCall(`/teams/${t.id}`, {
                                    method: "DELETE",
                                  });
                                  refreshOrganization();
                                },
                                confirmationTitle: "Delete Team",
                                cta: "Delete",
                                getConfirmationContent: async () =>
                                  `Are you sure you want to delete "${t.name}"?`,
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenu>
                      )) || (
                        <Tooltip
                          className="mr-2"
                          body="This team is managed by an external identity provider."
                        >
                          <RxIdCard className="text-blue" />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <p>Click the button in the top right to create your first team!</p>
      )}
    </Box>
  );
};

export default TeamsList;
