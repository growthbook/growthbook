import React, { FC, ReactNode, useEffect, useState } from "react";
import { ExpandedMember } from "shared/types/organization";
import { date, datetime } from "shared/dates";
import { RxIdCard } from "react-icons/rx";
import { BsThreeDotsVertical } from "react-icons/bs";
import router from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  getEffectiveRolesForProject,
  getRoleDisplayName,
} from "shared/permissions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import Link from "@/ui/Link";
import EnvironmentAccessCell from "@/components/Settings/EnvironmentAccessCell";
import Callout from "@/ui/Callout";
import { usingSSO } from "@/services/env";
import { useEnvironments } from "@/services/features";
import { MEMBER_COLUMN_WIDTHS } from "@/components/Settings/Team/memberTableWidths";
import InviteModal from "@/components/Settings/Team/InviteModal";
import AdminSetPasswordModal from "@/components/Settings/Team/AdminSetPasswordModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import ChangeProjectRoleModal from "@/components/Settings/Team/ChangeProjectRoleModal";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
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

const MemberList: FC<{
  mutate: () => void;
  project: string;
  canEditRoles?: boolean;
  canEditProjectRoles?: boolean; // Some users with the project-admin role can't edit global roles, but they can edit roles for a specific project
  canDeleteMembers?: boolean;
  canInviteMembers?: boolean;
  filters?: ReactNode;
}> = ({
  mutate,
  project,
  canEditRoles = true,
  canEditProjectRoles = false,
  canDeleteMembers = true,
  canInviteMembers = true,
  filters,
}) => {
  const [inviting, setInviting] = useState(!!router.query["just-subscribed"]);
  const { apiCall } = useAuth();
  const { userId, users, organization, teams } = useUser();
  const [roleModal, setRoleModal] = useState<string>("");
  const [projectRoleModal, setProjectRoleModal] = useState<string>("");
  const [passwordResetModal, setPasswordResetModal] =
    useState<ExpandedMember | null>(null);
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
  const projectRoleModalUser = users.get(projectRoleModal);

  const members = Array.from(users).sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );

  // Every project someone set a rule on — the member or one of their teams.
  const scopedProjectIds = (member: ExpandedMember) => [
    ...new Set([
      ...(member.projectRoles || []).map((pr) => pr.project),
      ...(member.teams || []).flatMap(
        (id) =>
          (teams || [])
            .find((t) => t.id === id)
            ?.projectRoles?.map((pr) => pr.project) || [],
      ),
    ]),
  ];

  const membersList: ExpandedMember[] = members.map(([, member]) => ({
    ...member,
    numTeams: member.teams?.length || 0,
  }));

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: membersList,
    localStorageKey: "members",
    defaultSortField: "name",
    searchFields: ["name", "email"],
    pageSize: 20,
    defaultMappings: {
      lastLoginDate: new Date(0).toISOString(),
    },
  });
  return (
    <>
      {canInviteMembers && inviting && (
        <InviteModal close={() => setInviting(false)} mutate={mutate} />
      )}
      {projectRoleModal && projectRoleModalUser && (
        <ChangeProjectRoleModal
          memberName={projectRoleModalUser.name || projectRoleModalUser.email}
          projectRole={
            projectRoleModalUser.projectRoles?.find(
              (r) => r.project === project,
            ) || {
              role: projectRoleModalUser.role,
              environments: projectRoleModalUser.environments || [],
              limitAccessByEnvironment:
                projectRoleModalUser.limitAccessByEnvironment || false,
              project: project,
            }
          }
          close={() => setProjectRoleModal("")}
          onConfirm={async (value) => {
            await apiCall(`/member/${projectRoleModal}/project-role`, {
              method: "PUT",
              body: JSON.stringify({ projectRole: value }),
            });
            mutate();
          }}
        />
      )}
      {canEditRoles && roleModal && roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
            additionalRoles: roleModalUser.additionalRoles,
          }}
          teams={(teams || []).filter((t) =>
            roleModalUser.teams?.includes(t.id),
          )}
          close={() => setRoleModal("")}
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
        <Flex align="center" justify="between" gap="3" mt="4" mb="2">
          <Flex align="center" gap="3">
            <h5 className="mb-0">Active Members{` (${users.size})`}</h5>
            <Box width="250px" flexShrink="0">
              <Field
                placeholder="Search..."
                type="search"
                containerClassName="mb-0"
                {...searchInputProps}
              />
            </Box>
            {filters}
          </Flex>
          {canInviteMembers && (
            <Button onClick={onInvite}>Invite member</Button>
          )}
        </Flex>
        <Table variant="surface" layout="fixed">
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader
                field="name"
                style={{ width: MEMBER_COLUMN_WIDTHS.name }}
              >
                Name
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="email"
                style={{ width: MEMBER_COLUMN_WIDTHS.email }}
              >
                Email
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="dateCreated"
                style={{ width: "10%" }}
              >
                Date Joined
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="lastLoginDate"
                style={{ width: "10%" }}
              >
                Last Login
              </SortableTableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.role}>
                <Tooltip body="The role(s) that actually apply after combining this member's own role with any teams they're on. Hover a value to see each source.">
                  {project ? "Project Role" : "Role"}
                </Tooltip>
              </TableColumnHeader>
              {!project && (
                <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.projectRoles}>
                  Project Roles
                </TableColumnHeader>
              )}
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.environments}>
                <Tooltip body="Environments this member can publish, create, delete and revert in. Hover a value for the full breakdown.">
                  Environments
                </Tooltip>
              </TableColumnHeader>
              <SortableTableColumnHeader
                field="numTeams"
                style={{ width: MEMBER_COLUMN_WIDTHS.teams }}
              >
                Teams
              </SortableTableColumnHeader>
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.actions} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((member) => {
              const effectiveRoles = getEffectiveRolesForProject(
                member,
                project || null,
                teams || [],
              );
              const effectiveByRole: { role: string; sources: string[] }[] = [];
              effectiveRoles.forEach((er) => {
                const src =
                  er.sourceType === "user"
                    ? "Direct"
                    : `Team: ${er.sourceName}`;
                const existing = effectiveByRole.find(
                  (e) => e.role === er.role,
                );
                if (existing) existing.sources.push(src);
                else effectiveByRole.push({ role: er.role, sources: [src] });
              });
              const effectiveLabel = effectiveByRole
                .map((e) => getRoleDisplayName(e.role, organization))
                .join(", ");
              const effectiveFromTeam = effectiveRoles.some(
                (er) => er.sourceType === "team",
              );
              return (
                <TableRow key={member.id}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell>
                    <Flex align="center" gap="2">
                      {member.managedByIdp && (
                        <Tooltip body="This user is managed by an external identity provider.">
                          <RxIdCard className="text-blue" />
                        </Tooltip>
                      )}
                      {member.email}
                    </Flex>
                  </TableCell>
                  <TableCell
                    title={
                      member.dateCreated
                        ? datetime(member.dateCreated)
                        : undefined
                    }
                  >
                    {member.dateCreated && date(member.dateCreated)}
                  </TableCell>
                  <TableCell
                    title={
                      member.lastLoginDate
                        ? datetime(member.lastLoginDate)
                        : undefined
                    }
                  >
                    {member.lastLoginDate && date(member.lastLoginDate)}
                  </TableCell>
                  <TableCell>
                    {effectiveFromTeam || effectiveByRole.length > 1 ? (
                      <Tooltip
                        body={
                          <>
                            {effectiveByRole.map((e) => (
                              <div key={e.role}>
                                {getRoleDisplayName(e.role, organization)} —{" "}
                                {e.sources.join(", ")}
                              </div>
                            ))}
                          </>
                        }
                      >
                        <span style={{ textDecoration: "underline dotted" }}>
                          {effectiveLabel}
                        </span>
                      </Tooltip>
                    ) : (
                      effectiveLabel
                    )}
                  </TableCell>
                  {!project && (
                    <TableCell>
                      {scopedProjectIds(member).map((projectId) => {
                        const p = projects.find((p) => p.id === projectId);
                        if (!p?.name) return null;
                        const roles = getEffectiveRolesForProject(
                          member,
                          projectId,
                          teams || [],
                        );
                        const label = [
                          ...new Set(
                            roles.map((r) =>
                              getRoleDisplayName(r.role, organization),
                            ),
                          ),
                        ].join(", ");
                        const fromTeam = roles.some(
                          (r) => r.sourceType === "team",
                        );
                        return (
                          <div key={`project-tags-${p.id}`}>
                            <ProjectBadges
                              resourceType="member"
                              projectIds={[p.id]}
                            />{" "}
                            —{" "}
                            {fromTeam ? (
                              <Tooltip
                                body={roles
                                  .map(
                                    (r) =>
                                      `${getRoleDisplayName(r.role, organization)} — ${
                                        r.sourceType === "team"
                                          ? `Team: ${r.sourceName}`
                                          : "Direct"
                                      }`,
                                  )
                                  .join("\n")}
                              >
                                <span
                                  style={{
                                    textDecoration: "underline dotted",
                                  }}
                                >
                                  {label}
                                </span>
                              </Tooltip>
                            ) : (
                              label
                            )}
                          </div>
                        );
                      })}
                    </TableCell>
                  )}
                  <TableCell>
                    <EnvironmentAccessCell
                      principal={member}
                      environments={environments}
                      organization={organization}
                      project={project}
                    />
                  </TableCell>

                  <TableCell>
                    {(member.teams ?? []).map((teamId) => {
                      const team = (teams ?? []).find((t) => t.id === teamId);
                      if (!team) return null;
                      return (
                        <div key={teamId}>
                          <Link href={`/settings/team/${teamId}`}>
                            {team.name}
                          </Link>
                        </div>
                      );
                    })}
                  </TableCell>

                  <TableCell justify="end">
                    {member.id !== userId && (
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
                          {canEditRoles && (
                            <DropdownMenuItem
                              onClick={() => {
                                setRoleModal(member.id);
                              }}
                            >
                              Edit role
                            </DropdownMenuItem>
                          )}
                          {!canEditRoles && canEditProjectRoles && (
                            <DropdownMenuItem
                              onClick={() => {
                                setProjectRoleModal(member.id);
                              }}
                            >
                              Edit Project role
                            </DropdownMenuItem>
                          )}
                          {canDeleteMembers && !usingSSO() && (
                            <DropdownMenuItem
                              onClick={() => {
                                setPasswordResetModal(member);
                              }}
                            >
                              Reset password
                            </DropdownMenuItem>
                          )}
                          {canDeleteMembers && (
                            <DropdownMenuItem
                              color="red"
                              confirmation={{
                                submit: async () => {
                                  await apiCall(`/member/${member.id}`, {
                                    method: "DELETE",
                                  });
                                  mutate();
                                },
                                confirmationTitle: "Remove user",
                                cta: "Remove user",
                                getConfirmationContent: async () => (
                                  <>
                                    Are you sure you want to remove{" "}
                                    {member.email}?
                                    {member.managedByIdp && (
                                      <Callout status="warning" mt="2">
                                        <Flex direction="column" gap="2">
                                          <Text weight="semibold" size="md">
                                            This user is managed by an external
                                            identity provider.
                                          </Text>
                                          <span>
                                            We suggest deprovisioning this user
                                            from your external identity provider
                                            directly.
                                          </span>
                                          <span>
                                            If you deprovision this user here,
                                            and they&apos;re still provisioned
                                            in your external identity provider,
                                            they will be automatically
                                            re-provisioned.
                                          </span>
                                        </Flex>
                                      </Callout>
                                    )}
                                  </>
                                ),
                              }}
                            >
                              Remove user
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!items.length && isFiltered && (
              <TableRow>
                <TableCell
                  colSpan={8 + environments.length + (project ? 0 : 1)}
                  style={{ textAlign: "center" }}
                >
                  No matching members found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {pagination}
      </div>
    </>
  );
};

export default MemberList;
