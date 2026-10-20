import React, { FC, useState, ReactElement } from "react";
import { Invite, MemberRoleInfo } from "shared/types/organization";
import { PiX } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date, datetime } from "shared/dates";
import { Box, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import {
  CollapsedRuleRows,
  projectRuleRows,
  ruleRows,
} from "@/components/Settings/Team/RoleRuleLabel";
import LoadingOverlay from "@/components/LoadingOverlay";
import { MEMBER_COLUMN_WIDTHS } from "@/components/Settings/Team/memberTableWidths";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
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

  const { getProjectById } = useDefinitions();

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
      <Heading as="h5" size="sm" mb="1">
        Pending Invites{` (${invites.length})`}
      </Heading>
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
      <Table variant="surface" layout="fixed">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.emailNoName}>
              Email
            </TableColumnHeader>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.dateOnly}>
              Date Invited
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
                  <CollapsedRuleRows rows={ruleRows(roleInfo, organization)} />
                </TableCell>
                {!project && (
                  <TableCell>
                    <CollapsedRuleRows
                      rows={projectRuleRows(
                        member.projectRoles ?? [],
                        getProjectById,
                        organization,
                      )}
                    />
                  </TableCell>
                )}
                <TableCell />
                <TableCell justify="end">
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
