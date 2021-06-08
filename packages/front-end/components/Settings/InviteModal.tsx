import { FC, useState } from "react";
import { MemberRole, useAuth } from "../../services/auth";
import useForm from "../../hooks/useForm";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import track from "../../services/track";

const InviteModal: FC<{ mutate: () => void; close: () => void }> = ({
  mutate,
  close,
}) => {
  const [value, inputProps, manualUpdate] = useForm<{
    email: string;
    role: MemberRole;
  }>({
    email: "",
    role: "admin",
  });
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const { apiCall } = useAuth();

  const onSubmit = async () => {
    const resp = await apiCall<{
      emailSent: boolean;
      inviteUrl: string;
      status: number;
      message?: string;
    }>(`/invite`, {
      method: "POST",
      body: JSON.stringify(value),
    });

    if (resp.emailSent) {
      mutate();
      close();
    } else {
      setInviteUrl(resp.inviteUrl);
      setEmailSent(resp.emailSent);
      mutate();
    }

    track("Team Member Invited", {
      emailSent,
      role: value.role,
    });
  };

  return (
    <Modal
      close={close}
      header="Invite Member"
      open={true}
      cta="Invite"
      autoCloseOnSubmit={false}
      submit={emailSent === null ? onSubmit : null}
    >
      {emailSent === false && (
        <>
          <div className="alert alert-danger">
            Failed to send invite email to <strong>{value.email}</strong>
          </div>
          <p>You can manually send them the following invite link:</p>
          <div className="mb-3">
            <code>{inviteUrl}</code>
          </div>
        </>
      )}
      {emailSent === null && (
        <>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              className="form-control"
              required
              {...inputProps.email}
            />
          </div>
          <div className="mb-2">Role</div>
          <RoleSelector
            role={value.role}
            setRole={(role) => {
              manualUpdate({
                role,
              });
            }}
          />
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
