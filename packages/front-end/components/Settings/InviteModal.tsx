import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import track from "../../services/track";
import Field from "../Forms/Field";
import { MemberRole } from "back-end/types/organization";
import InviteModalSubscriptionInfo from "./InviteModalSubscriptionInfo";
import useStripeSubscription from "../../hooks/useStripeSubscription";
import UpgradeModal from "./UpgradeModal";

const InviteModal: FC<{ mutate: () => void; close: () => void }> = ({
  mutate,
  close,
}) => {
  const form = useForm<{
    email: string;
    role: MemberRole;
  }>({
    defaultValues: {
      email: "",
      role: "admin",
    },
  });
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const { apiCall } = useAuth();
  const {
    freeSeats,
    canSubscribe,
    activeAndInvitedUsers,
  } = useStripeSubscription();
  const [showUpgradeModal, setShowUpgradeModal] = useState(
    canSubscribe && activeAndInvitedUsers >= freeSeats
  );

  // Hit their free limit and needs to upgrade to invite more team members
  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={close}
        source="invite team"
        reason="Whoops! You reached your free seat limit."
      />
    );
  }

  const onSubmit = form.handleSubmit(async (value) => {
    const inviteArr = value.email.split(",");

    if (canSubscribe && activeAndInvitedUsers + inviteArr.length > freeSeats) {
      setShowUpgradeModal(true);
      return;
    }

    for (const email of inviteArr) {
      const resp = await apiCall<{
        emailSent: boolean;
        inviteUrl: string;
        status: number;
        message?: string;
      }>(`/invite`, {
        method: "POST",
        body: JSON.stringify({
          email: email,
          role: value.role,
        }),
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
    }
  });

  const email = form.watch("email");

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
            {email.split(",").length > 1 ? (
              "Failed to send the invite emails. To manually send the invite link, click the '3 dots' next to each invitee."
            ) : (
              <span>
                Failed to send invite email to <strong>{email}</strong>
              </span>
            )}
          </div>
          {email.split(",").length === 1 && (
            <>
              <p>You can manually send them the following invite link:</p>
              <div className="mb-3">
                <code>{inviteUrl}</code>
              </div>
            </>
          )}
        </>
      )}
      {emailSent === null && (
        <>
          <Field
            label="Email Address"
            required
            helpText="Enter a comma separated list of emails to invite multiple members at once."
            {...form.register("email")}
          />
          <RoleSelector
            role={form.watch("role")}
            setRole={(role) => {
              form.setValue("role", role);
            }}
          />
          <InviteModalSubscriptionInfo />
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
