import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import track from "../../services/track";
import Field from "../Forms/Field";
import { MemberRole } from "back-end/types/organization";
import { isCloud } from "../../services/env";
import { InviteModalSubscriptionInfo } from "./InviteModalSubscriptionInfo";
import useStripeSubscription from "../../hooks/useStripeSubscription";
import { useGrowthBook } from "@growthbook/growthbook-react";

const InviteModal: FC<{ mutate: () => void; close: () => void }> = ({
  mutate,
  close,
}) => {
  const growthbook = useGrowthBook();
  const selfServePricing = growthbook.feature("self-serve-billing");
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
    pricePerSeat,
    activeAndInvitedUsers,
    numberOfCurrentSeats,
    hasActiveSubscription,
    subscriptionStatus,
  } = useStripeSubscription();

  const currentPaidSeats = numberOfCurrentSeats || 0;

  const canInviteUser = Boolean(
    emailSent === null &&
      (activeAndInvitedUsers < freeSeats ||
        (currentPaidSeats >= freeSeats && hasActiveSubscription) ||
        !isCloud())
  );

  const onSubmit = form.handleSubmit(async (value) => {
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
  });

  const email = form.watch("email");

  return (
    <Modal
      close={close}
      header="Invite Member"
      open={true}
      cta="Invite"
      ctaEnabled={canInviteUser}
      autoCloseOnSubmit={false}
      submit={emailSent === null ? onSubmit : null}
    >
      {emailSent === false && (
        <>
          <div className="alert alert-danger">
            Failed to send invite email to <strong>{email}</strong>
          </div>
          <p>You can manually send them the following invite link:</p>
          <div className="mb-3">
            <code>{inviteUrl}</code>
          </div>
        </>
      )}
      {emailSent === null && (
        <>
          <Field
            label="Email Address"
            type="email"
            required
            {...form.register("email")}
          />
          <RoleSelector
            role={form.watch("role")}
            setRole={(role) => {
              form.setValue("role", role);
            }}
          />
          {selfServePricing.on && (
            <InviteModalSubscriptionInfo
              subscriptionStatus={subscriptionStatus}
              activeAndInvitedUsers={activeAndInvitedUsers}
              freeSeats={freeSeats}
              hasActiveSubscription={hasActiveSubscription}
              pricePerSeat={pricePerSeat}
              currentPaidSeats={currentPaidSeats}
            />
          )}
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
