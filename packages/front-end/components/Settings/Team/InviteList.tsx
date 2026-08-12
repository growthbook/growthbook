import React, { FC, useState, ReactElement } from "react";
import { Invite, MemberRoleInfo } from "shared/types/organization";
import { PiCheckBold, PiX, PiXBold } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date, datetime } from "shared/dates";
import { getRoleDisplayName } from "shared/permissions";
import { Box, IconButton } from "@radix-ui/themes";
import { memberEnvAccess, useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useEnvironments } from "@/services/features";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
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
import ChangeRoleModal from "./ChangeRoleModal";

type ChangeRoleInfo = {
  roleInfo: MemberRoleInfo;
  displayInfo: string;
  key: string;
};

const InviteList: FC<{
  invites: Invite[];
  mutate: () => void;
  project: string;
}> = ({ invites, mutate, project }) => {
  const { apiCall } = useAuth();
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
  const [roleModal, setRoleModal] = useState<ChangeRoleInfo>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);

  const { organization } = useUser();

  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const forceScroll = environments.length > 3;

  const onResend = async (key: string, email: string) => {
    if (resending) return;
    setResending(true);
    setResendMessage(null);

    const dismissButton = (
      <IconButton
        variant="ghost"
        color="gray"
        highContrast
        aria-label="Close"
        onClick={() => setResendMessage(null)}
      >
        <PiX />
      </IconButton>
    );

    try {
      const { status, message, inviteUrl, emailSent } = await apiCall<{
        status: number;
        message: string;
        inviteUrl: string;
        emailSent: boolean;
      }>(`/invite/resend`, {
        method: "POST",
        body: JSON.stringify({
          key,
        }),
      });

      if (status !== 200) {
        setResendMessage(
          <Callout status="error" action={dismissButton}>
            {message || "Error re-sending the invitation"}
          </Callout>,
        );
      } else if (!emailSent) {
        setResendMessage(
          <Callout status="info" action={dismissButton}>
            <p>
              Failed to send email to <strong>{email}</strong>. You can manually
              send them the following invite link:
            </p>
            <div>
              <code>{inviteUrl}</code>
            </div>
          </Callout>,
        );
      }
    } catch (e) {
      setResendMessage(
        <Callout status="error" action={dismissButton}>
          {e.message}
        </Callout>,
      );
    }

    setResending(false);
  };

  return (
    <Box>
      <h5>Pending Invites{` (${invites.length})`}</h5>
      <Text as="p" color="text-mid" mb="2">
        Invites that have been sent but have not yet been accepted.{" "}
        <strong>Invited users count towards plan seat limits.</strong>
      </Text>
      {roleModal && (
        <ChangeRoleModal
          displayInfo={roleModal.displayInfo}
          roleInfo={roleModal.roleInfo}
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
          close={() => setRoleModal(null)}
          onConfirm={async (value) => {
            await apiCall(`/invite/${roleModal.key}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      {resending && <LoadingOverlay />}
      {resendMessage}
      <Table
        variant="surface"
        style={forceScroll ? { whiteSpace: "nowrap" } : undefined}
      >
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Date Invited</TableColumnHeader>
            <TableColumnHeader>
              {project ? "Project Role" : "Global Role"}
            </TableColumnHeader>
            {!project && <TableColumnHeader>Project Roles</TableColumnHeader>}
            {environments.map((env) => (
              <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
            ))}
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map(({ email, key, dateCreated, ...member }) => {
            const roleInfo =
              (project &&
                member.projectRoles?.find((r) => r.project === project)) ||
              member;
            return (
              <TableRow key={key}>
                <TableCell>{email}</TableCell>
                <TableCell title={datetime(dateCreated)}>
                  {date(dateCreated)}
                </TableCell>
                <TableCell>
                  {getRoleDisplayName(roleInfo.role, organization)}
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
                          setRoleModal({
                            key,
                            displayInfo: email,
                            roleInfo,
                          });
                        }}
                      >
                        Edit role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          onResend(key, email);
                        }}
                      >
                        Resend invite
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: async () => {
                            setResendMessage(null);
                            await apiCall(`/invite`, {
                              method: "DELETE",
                              body: JSON.stringify({ key }),
                            });
                            mutate();
                          },
                          confirmationTitle: `Remove ${email}?`,
                          cta: "Remove",
                        }}
                      >
                        Remove
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

export default InviteList;
