import { FC, useState } from "react";
import { PiUserCheck } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PendingMember } from "shared/types/organization";
import { date, datetime } from "shared/dates";
import { Box, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { RoleRuleLines } from "@/components/Settings/Team/RoleRuleLabel";
import ProjectBadges from "@/components/ProjectBadges";
import { MEMBER_COLUMN_WIDTHS } from "@/components/Settings/Team/memberTableWidths";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";
import { useUser } from "@/services/UserContext";
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
  const { organization } = useUser();

  return (
    <Box my="4">
      <h5>Pending Members{` (${pendingMembers.length})`}</h5>
      <Text as="p" color="text-mid" mb="2">
        Members who have requested to join this organization. They must be
        manually approved.
      </Text>
      {roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
            additionalRoles: roleModalUser.additionalRoles,
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
      <Table variant="surface" layout="fixed">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.name}>
              Name
            </TableColumnHeader>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.email}>
              Email
            </TableColumnHeader>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.dateOnly}>
              Date Joined
            </TableColumnHeader>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.role}>
              {project ? "Project Role" : "Role"}
            </TableColumnHeader>
            {!project && (
              <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.projectRoles}>
                Project Roles
              </TableColumnHeader>
            )}
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.teams} />
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.actions} />
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
                  <RoleRuleLines scope={roleInfo} organization={organization} />
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
                            <RoleRuleLines
                              scope={pr}
                              organization={organization}
                            />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </TableCell>
                )}
                <TableCell>
                  <Button
                    variant="outline"
                    icon={<PiUserCheck />}
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
