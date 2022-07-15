import { FC, useState, ReactElement } from "react";
import { FaTrash, FaEnvelope } from "react-icons/fa";
import ConfirmModal from "../ConfirmModal";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import useApi from "../../hooks/useApi";
import { SettingsApiResponse } from "../../pages/settings";

const InviteList: FC<{
  invites: { key: string; email: string; role: string; dateCreated: string }[];
  mutate: () => void;
}> = ({ invites, mutate }) => {
  const [deleteInvite, setDeleteInvite] = useState<{
    key: string;
    email: string;
  } | null>(null);
  const { apiCall } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<ReactElement | null>(null);
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const totalSeats =
    data.organization.invites.length + data.organization.members.length;

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
          await apiCall<{
            qty: string;
            organizationId: string;
            subscriptionId: string;
          }>(`/subscription/updateSubscription`, {
            method: "POST",
            body: JSON.stringify({
              qty: totalSeats - 1,
              organizationId: data.organization.id,
              subscriptionId: data.organization.subscription.id,
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
              <td>{dateCreated}</td>
              <td>{role}</td>
              <td>
                <button
                  className="btn btn-outline-primary mr-2"
                  onClick={(e) => {
                    e.preventDefault();
                    onResend(key, email);
                  }}
                >
                  <FaEnvelope /> Resend Invite
                </button>
                <button
                  className="btn btn-outline-danger"
                  onClick={async (e) => {
                    e.preventDefault();
                    setDeleteInvite({ email, key });
                    setResendMessage(null);
                  }}
                >
                  <FaTrash /> Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default InviteList;
