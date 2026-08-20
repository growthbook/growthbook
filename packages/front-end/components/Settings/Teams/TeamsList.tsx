import React, { FC, useState } from "react";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import { RxIdCard } from "react-icons/rx";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, IconButton } from "@radix-ui/themes";
import Link from "@/ui/Link";
import { Team, useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import EnvironmentAccessCell from "@/components/Settings/EnvironmentAccessCell";
import RoleRuleLabel from "@/components/Settings/Team/RoleRuleLabel";
import { PermissionsModal } from "@/components/Settings/Teams/PermissionModal";
import { MEMBER_COLUMN_WIDTHS } from "@/components/Settings/Team/memberTableWidths";
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

// Everything a scope grants: its base role plus any additional rules, each
// carrying its own environment restriction.
function teamRules(scope: {
  role: string;
  limitAccessByEnvironment?: boolean;
  environments?: string[];
  additionalRoles?: {
    role: string;
    limitAccessByEnvironment: boolean;
    environments: string[];
  }[];
}) {
  return [scope, ...(scope.additionalRoles ?? [])].map((rule) => ({
    role: rule.role,
    limitAccessByEnvironment: !!rule.limitAccessByEnvironment,
    environments: rule.environments ?? [],
  }));
}

const TeamsList: FC<{ onDuplicate?: (team: Team) => void }> = ({
  onDuplicate,
}) => {
  const { teams, refreshOrganization, organization } = useUser();
  const [permissionsTeamId, setPermissionsTeamId] = useState<string | null>(
    null,
  );
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canManageTeam = permissionsUtil.canManageTeam();

  const permissionsTeam = teams?.find((t) => t.id === permissionsTeamId);

  return (
    <Box mb="4">
      {permissionsTeam && (
        <PermissionsModal
          team={permissionsTeam}
          open={true}
          onClose={() => setPermissionsTeamId(null)}
          onSuccess={async () => {
            refreshOrganization();
            setPermissionsTeamId(null);
          }}
        />
      )}
      {teams && teams.length > 0 ? (
        <Table variant="surface" layout="fixed">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Team Name</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Date Updated</TableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.role}>
                Role
              </TableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.projectRoles}>
                Project Roles
              </TableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.environments}>
                <Tooltip body="Environments this team can publish, create, delete and revert in. Hover a value for the full breakdown.">
                  Environments
                </Tooltip>
              </TableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.teams}>
                Members
              </TableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.actions} />
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
                    {t.managedBy?.type && (
                      <div>
                        <Badge
                          label={`Managed by ${capitalizeFirstLetter(
                            t.managedBy.type,
                          )}`}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-gray" style={{ fontSize: 12 }}>
                    {t.description}
                  </TableCell>
                  <TableCell>{date(t.dateUpdated)}</TableCell>
                  <TableCell>
                    {teamRules(t).map((rule, i) => (
                      <div key={i}>
                        <RoleRuleLabel {...rule} organization={organization} />
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    {t.projectRoles?.map((pr) => {
                      const p = projects.find((p) => p.id === pr.project);
                      if (!p?.name) return null;
                      return (
                        <div key={`project-tags-${p.id}`}>
                          <ProjectBadges
                            resourceType="team"
                            projectIds={[p.id]}
                          />{" "}
                          {teamRules(pr).map((rule, i) => (
                            <div key={i}>
                              <RoleRuleLabel
                                {...rule}
                                organization={organization}
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </TableCell>
                  <TableCell>
                    <EnvironmentAccessCell
                      principal={t}
                      environments={environments}
                      organization={organization}
                      project=""
                    />
                  </TableCell>
                  <TableCell>{t.members?.length ?? 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canManageTeam && !teamIsExternallyManaged ? (
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
                            onClick={() => setPermissionsTeamId(t.id)}
                          >
                            Edit permissions
                          </DropdownMenuItem>
                          {onDuplicate && (
                            <DropdownMenuItem onClick={() => onDuplicate(t)}>
                              Duplicate
                            </DropdownMenuItem>
                          )}
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
                    ) : (
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
      ) : (
        <p>Click the button in the top right to create your first team!</p>
      )}
    </Box>
  );
};

export default TeamsList;
