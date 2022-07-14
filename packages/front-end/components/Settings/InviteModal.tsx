import { FC, useEffect, useState } from "react";
import { useAuth } from "../../services/auth";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import track from "../../services/track";
import Field from "../Forms/Field";
import { MemberRole } from "back-end/types/organization";
import useApi from "../../hooks/useApi";
import { SettingsApiResponse } from "../../pages/settings";
import useUser from "../../hooks/useUser";
import { isCloud } from "../../services/env";
import { InviteModalBillingWarnings } from "./InviteModalBillingWarnings";

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
  const [subscriptionData, setSubscriptionData] = useState(null);
  const { apiCall } = useAuth();
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const user = useUser();

  useEffect(() => {
    const getSubscriptionData = async () => {
      const { subscription } = await apiCall(`/subscription`);
      setSubscriptionData(subscription);
    };

    getSubscriptionData();
  }, []);

  const numOfFreeSeats = subscriptionData?.plan.metadata.freeSeats || 5;
  const currentNumOfSeats =
    data.organization.members.length + data.organization.invites.length;
  const totalSeats = data.organization.subscription.qty || 0;
  const hasActiveSubscription =
    data.organization.subscription?.status === "active" ||
    data.organization.subscription?.status === "trialing";
  const canInviteUser = Boolean(
    emailSent === null &&
      (currentNumOfSeats < numOfFreeSeats ||
        (totalSeats >= numOfFreeSeats && hasActiveSubscription))
  );
  const pricePerSeat = subscriptionData?.plan.metadata.price || 20;

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

    if (totalSeats <= currentNumOfSeats) {
      await apiCall<{
        qty: string;
        organizationId: string;
        subscriptionId: string;
      }>(`/subscription/updateSubscription`, {
        method: "POST",
        body: JSON.stringify({
          qty: totalSeats + 1,
          organizationId: data.organization.id,
          subscriptionId: data.organization.subscription.id,
        }),
      });
    }

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
      ctaEnabled={!isCloud() || canInviteUser}
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
          <InviteModalBillingWarnings
            subscriptionStatus={data.organization.subscription?.status}
            currentNumOfSeats={currentNumOfSeats}
            numOfFreeSeats={numOfFreeSeats}
            hasActiveSubscription={hasActiveSubscription}
            pricePerSeat={pricePerSeat}
            totalSeats={totalSeats}
            email={user.email}
            organizationId={data.organization.id}
          />
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
