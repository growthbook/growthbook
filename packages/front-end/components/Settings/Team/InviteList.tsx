import React, { FC, useState, ReactElement } from "react";
import { Invite, MemberRoleInfo } from "shared/types/organization";
import { FaCheck, FaTimes } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date, datetime } from "shared/dates";
import { getRoleDisplayName } from "shared/permissions";
import { Box, IconButton } from "@radix-ui/themes";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useEnvironments } from "@/services/features";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
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
      <button
        type="button"
        className="close"
        data-dismiss="alert"
        aria-label="Close"
        onClick={(e) => {
          e.preventDefault();
          setResendMessage(null);
        }}
      >
        <span aria-hidden="true">&times;</span>
      </button>
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
          <Callout status="error">
            {dismissButton}
            {message || "Error re-sending the invitation"}
          </Callout>,
        );
      } else if (!emailSent) {
        setResendMessage(
          <Callout status="info">
            {dismissButton}
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
        <Callout status="error">
          {dismissButton}
          {e.message}
        </Callout>,
      );
    }

    setResending(false);
  };

  return (
    <Box>
      <h5>Pending Invites{` (${invites.length})`}</h5>
      <div className="text-muted mb-2">
        Invites that have been sent but have not yet been accepted.{" "}
        <strong>Invited users count towards plan seat limits.</strong>
      </div>
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
                  const access = roleHasAccessToEnv(
                    roleInfo,
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
                        Edit Role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          onResend(key, email);
                        }}
                      >
                        Resend Invite
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
