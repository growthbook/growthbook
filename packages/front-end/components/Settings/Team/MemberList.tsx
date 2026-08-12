import React, { FC, useEffect, useState } from "react";
import { PiCheckBold, PiXBold } from "react-icons/pi";
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
import { memberEnvAccess, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import Callout from "@/ui/Callout";
import { usingSSO } from "@/services/env";
import { useEnvironments } from "@/services/features";
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
}> = ({
  mutate,
  project,
  canEditRoles = true,
  canEditProjectRoles = false,
  canDeleteMembers = true,
  canInviteMembers = true,
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
  // Past a few environment columns the table is too wide to fit; keep the
  // columns at their natural width and let it scroll rather than compressing
  // them to slivers.
  const forceScroll = environments.length > 3;

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
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: membersList || [],
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
          }}
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
                size="legacy"
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
          </Flex>
          {canInviteMembers && (
            <Button onClick={onInvite}>Invite member</Button>
          )}
        </Flex>
        <Table
          variant="surface"
          style={forceScroll ? { whiteSpace: "nowrap" } : undefined}
        >
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader field="name">
                Name
              </SortableTableColumnHeader>
              <SortableTableColumnHeader field="email">
                Email
              </SortableTableColumnHeader>
              <SortableTableColumnHeader field="dateCreated">
                Date Joined
              </SortableTableColumnHeader>
              <SortableTableColumnHeader field="lastLoginDate">
                Last Login
              </SortableTableColumnHeader>
              <TableColumnHeader>
                {project ? "Project Role" : "Global Role"}
              </TableColumnHeader>
              <TableColumnHeader>
                <Tooltip body="The role(s) that actually apply after combining this member's own role with any teams they're on. Hover a value to see each source.">
                  {project ? "Effective Project Role" : "Effective Global Role"}
                </Tooltip>
              </TableColumnHeader>
              {!project && <TableColumnHeader>Project Roles</TableColumnHeader>}
              {environments.map((env) => (
                <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
              ))}
              <SortableTableColumnHeader field="numTeams">
                Teams
              </SortableTableColumnHeader>
              <TableColumnHeader style={{ width: 50 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((member) => {
              const roleInfo =
                (project &&
                  member.projectRoles?.find((r) => r.project === project)) ||
                member;
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
                      {member.managedByIdp ? (
                        <Tooltip body="This user is managed by an external identity provider.">
                          <RxIdCard className="text-blue" />
                        </Tooltip>
                      ) : null}
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
                    {getRoleDisplayName(roleInfo.role, organization)}
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
                      {member.projectRoles?.map((pr) => {
                        const p = projects.find((p) => p.id === pr.project);
                        if (p?.name) {
                          return (
                            <div key={`project-tags-${p.id}`}>
                              <ProjectBadges
                                resourceType="member"
                                projectIds={[p.id]}
                              />{" "}
                              — {getRoleDisplayName(pr.role, organization)}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </TableCell>
                  )}
                  {environments.map((env) => {
                    const access = memberEnvAccess(
                      member,
                      env,
                      organization,
                      project,
                    );
                    return (
                      <TableCell key={env.id}>
                        {access === "N/A" ? (
                          <Text color="text-low">N/A</Text>
                        ) : access === "yes" ? (
                          <PiCheckBold color="var(--green-11)" />
                        ) : (
                          <PiXBold color="var(--red-11)" />
                        )}
                      </TableCell>
                    );
                  })}

                  <TableCell>
                    {member.teams ? member.teams.length : 0}
                  </TableCell>

                  <TableCell>
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
                              Edit project role
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
                                    {member.managedByIdp ? (
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
                                    ) : null}
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
