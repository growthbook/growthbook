import { FC, useState } from "react";
import { FaCheck, FaTimes, FaUserCheck } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PendingMember } from "shared/types/organization";
import { date, datetime } from "shared/dates";
import { getRoleDisplayName } from "shared/permissions";
import { Box, IconButton } from "@radix-ui/themes";
import { memberEnvAccess, useAuth } from "@/services/auth";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";
import { useUser } from "@/services/UserContext";
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

const PendingMemberList: FC<{
  pendingMembers: PendingMember[];
  mutate: () => void;
  project: string;
}> = ({ pendingMembers, mutate, project }) => {
  const { apiCall } = useAuth();
  const [roleModalUser, setRoleModalUser] = useState<PendingMember | null>(
    null,
  );
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const forceScroll = environments.length > 3;
  const { organization } = useUser();

  return (
    <Box my="4">
      <h5>Pending Members{` (${pendingMembers.length})`}</h5>
      <div className="text-muted mb-2">
        Members who have requested to join this organization. They must be
        manually approved.
      </div>
      {roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
          }}
          close={() => setRoleModalUser(null)}
          onConfirm={async (value) => {
            await apiCall(`/member/${roleModalUser.id}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      <Table
        variant="surface"
        style={forceScroll ? { whiteSpace: "nowrap" } : undefined}
      >
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Date Joined</TableColumnHeader>
            <TableColumnHeader>
              {project ? "Project Role" : "Global Role"}
            </TableColumnHeader>
            {!project && <TableColumnHeader>Project Roles</TableColumnHeader>}
            {environments.map((env) => (
              <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
            ))}
            <TableColumnHeader />
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pendingMembers.map((member) => {
            const roleInfo =
              (project &&
                member.projectRoles?.find((r) => r.project === project)) ||
              member;
            return (
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
                  {getRoleDisplayName(roleInfo.role, organization)}
                </TableCell>
                {!project && (
                  <TableCell>
                    {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                    {member.projectRoles.map((pr) => {
                      const p = projects.find((p) => p.id === pr.project);
                      if (p?.name) {
                        return (
                          <div key={`project-tags-${p.id}`}>
                            <ProjectBadges
                              resourceType="member"
                              projectIds={[p.id]}
                            />
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
                        <span className="text-muted">N/A</span>
                      ) : access === "yes" ? (
                        <FaCheck className="text-success" />
                      ) : (
                        <FaTimes className="text-danger" />
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <Button
                    variant="outline"
                    icon={<FaUserCheck />}
                    onClick={async () => {
                      await apiCall(`/member/${member.id}/approve`, {
                        method: "POST",
                      });
                      mutate();
                    }}
                  >
                    Approve
                  </Button>
                </TableCell>
                <TableCell>
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
                        onClick={() => {
                          setRoleModalUser(member);
                        }}
                      >
                        Edit Role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: async () => {
                            await apiCall(`/member/${member.id}`, {
                              method: "DELETE",
                            });
                            mutate();
                          },
                          confirmationTitle: "Remove User",
                          cta: "Remove User",
                          getConfirmationContent: async () =>
                            `Are you sure you want to remove ${member.email}?`,
                        }}
                      >
                        Remove User
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
};

export default PendingMemberList;
