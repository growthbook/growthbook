import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import RoleSelector from "./RoleSelector";
import track from "../../services/track";
import Field from "../Forms/Field";
import { MemberRole } from "back-end/types/organization";
import useApi from "../../hooks/useApi";
import { SettingsApiResponse } from "../../pages/settings";
import router from "next/router";
import useUser from "../../hooks/useUser";
import { Stripe } from "stripe";
import { isCloud } from "../../services/env";

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
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const user = useUser();

  const numOfFreeSeats = 5; // Do we have a place in the app where we define universal constants like this? Just thinking if we ever want to update this in the future
  const totalSeats =
    data.organization.invites.length + data.organization.members.length;
  const hasActiveSubscription =
    data.organization.subscription?.status === "active" ||
    data.organization.subscription?.status === "trialing";
  const canInviteUser = Boolean(
    emailSent === null &&
      (totalSeats < numOfFreeSeats ||
        (totalSeats >= numOfFreeSeats && hasActiveSubscription))
  );
  const pricePerSeat = 2000; // Eventually this will need to come from stripe so we can support different price amounts

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

  const startStripeSubscription = async () => {
    const resp = await apiCall<{
      status: number;
      session: Stripe.Checkout.Session;
    }>(`/subscription/checkout`, {
      method: "POST",
      body: JSON.stringify({
        qty: totalSeats + 1,
        email: user.email,
      }),
    });

    if (resp.session.url) {
      router.push(resp.session.url);
    }
  };

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
          {isCloud() && totalSeats <= numOfFreeSeats && hasActiveSubscription && (
            <p className="mt-3 mb-0 alert-warning alert">
              This user will be assigned a new seat{" "}
              <strong>(${pricePerSeat / 100}/month)</strong>
            </p>
          )}
          {isCloud() && totalSeats >= numOfFreeSeats && !hasActiveSubscription && (
            <p className="mt-3 mb-0 alert-warning alert">
              Whoops! You&apos;re currently in the <strong>Free Plan</strong>{" "}
              which only allows {numOfFreeSeats} seats. To add a seat ($
              {pricePerSeat / 100}/month), please{" "}
              <strong>
                <button
                  type="button"
                  className="btn btn-link p-0 align-baseline shadow-none"
                  onClick={startStripeSubscription}
                >
                  <strong>upgrade your plan</strong>
                </button>
              </strong>
              .
            </p>
          )}
        </>
      )}
    </Modal>
  );
};

export default InviteModal;
