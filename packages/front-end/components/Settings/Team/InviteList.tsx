import React, { FC, useState, ReactElement } from "react";
import { Invite, MemberRoleInfo } from "back-end/types/organization";
import { FaCheck, FaTimes } from "react-icons/fa";
import { datetime } from "shared/dates";
import ConfirmModal from "@/components/ConfirmModal";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useEnvironments } from "@/services/features";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ChangeRoleModal from "./ChangeRoleModal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

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
  const [deleteInvite, setDeleteInvite] = useState<{
    key: string;
    email: string;
  } | null>(null);
  const { apiCall } = useAuth();
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
  const [roleModal, setRoleModal] = useState<ChangeRoleInfo>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);

  const { organization } = useUser();

  const { projects } = useDefinitions();
  const environments = useEnvironments();

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
          <div className="alert alert-danger">
            {dismissButton}
            {message || "Error re-sending the invitation"}
          </div>,
        );
      } else if (!emailSent) {
        setResendMessage(
          <div className="alert alert-info">
            {dismissButton}
            <p>
              Failed to send email to <strong>{email}</strong>. You can manually
              send them the following invite link:
            </p>
            <div>
              <code>{inviteUrl}</code>
            </div>
          </div>,
        );
      }
    } catch (e) {
      setResendMessage(
        <div className="alert alert-danger">
          {dismissButton}
          {e.message}
        </div>,
      );
    }

    setResending(false);
  };

  return (
    <div>
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
      <ConfirmModal
        title={deleteInvite ? `Remove ${deleteInvite.email}?` : "Remove invite"}
        subtitle=""
        yesText="Remove"
        noText="Cancel"
        modalState={deleteInvite !== null}
        setModalState={() => setDeleteInvite(null)}
        onConfirm={async () => {
          // @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'key' does not exist on type '{ key: stri... Remove this comment to see the full error message
          const { key } = deleteInvite;
          setDeleteInvite(null);
          await apiCall(`/invite`, {
            method: "DELETE",
            body: JSON.stringify({
              key,
            }),
          });
          mutate();
        }}
      />
      {resending && <LoadingOverlay />}
      {resendMessage}
      <div style={{ overflowY: "auto" }}>
        <Table variant="standard" hover className="appbox">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Email</TableColumnHeader>
              <TableColumnHeader>Date Invited</TableColumnHeader>
              <TableColumnHeader>{project ? "Project Role" : "Global Role"}</TableColumnHeader>
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
                  <TableCell>{datetime(dateCreated)}</TableCell>
                  <TableCell>{roleInfo.role}</TableCell>
                  {!project && (
                    <TableCell className="col-3">
                      {member.projectRoles?.map((pr) => {
                        const p = projects.find((p) => p.id === pr.project);
                        if (p?.name) {
                          return (
                            <div key={`project-tags-${p.id}`}>
                              <ProjectBadges
                                resourceType="member"
                                projectIds={[p.id]}
                              />{" "}
                              — {pr.role}
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
                    <MoreMenu>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setRoleModal({
                            key,
                            displayInfo: email,
                            roleInfo,
                          });
                        }}
                      >
                        Edit Role
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          onResend(key, email);
                        }}
                      >
                        Resend Invite
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteInvite({ email, key });
                          setResendMessage(null);
                        }}
                      >
                        Remove
                      </button>
                    </MoreMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default InviteList;
