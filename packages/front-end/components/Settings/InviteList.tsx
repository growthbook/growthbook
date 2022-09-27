import React, { FC, useState, ReactElement } from "react";
import ConfirmModal from "../ConfirmModal";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import { Invite } from "back-end/types/organization";
import { datetime } from "../../services/dates";
import MoreMenu from "../Dropdown/MoreMenu";
import ChangeRoleModal, { ChangeRoleInfo } from "./ChangeRoleModal";

const InviteList: FC<{
  invites: Invite[];
  mutate: () => void;
}> = ({ invites, mutate }) => {
  const [deleteInvite, setDeleteInvite] = useState<{
    key: string;
    email: string;
  } | null>(null);
  const { apiCall } = useAuth();
  const [roleModal, setRoleModal] = useState<ChangeRoleInfo>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);

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
          </div>
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
          </div>
        );
      }
    } catch (e) {
      setResendMessage(
        <div className="alert alert-danger">
          {dismissButton}
          {e.message}
        </div>
      );
    }

    setResending(false);
  };

  return (
    <div>
      <h5>Pending Invites</h5>
      {roleModal && (
        <ChangeRoleModal
          roleInfo={roleModal}
          close={() => setRoleModal(null)}
          onConfirm={async (role) => {
            await apiCall(`/invite/${roleModal.uniqueKey}/role`, {
              method: "PUT",
              body: JSON.stringify({
                role,
              }),
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
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Email</th>
            <th>Date Invited</th>
            <th>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invites.map(({ email, key, dateCreated, role }) => (
            <tr key={key}>
              <td>{email}</td>
              <td>{datetime(dateCreated)}</td>
              <td>{role}</td>
              <td>
                <MoreMenu id="invite-actions">
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      setRoleModal({
                        uniqueKey: key,
                        displayInfo: email,
                        role: role,
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default InviteList;
