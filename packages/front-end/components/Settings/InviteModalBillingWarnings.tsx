import { FC, useState } from "react";
import router from "next/router";
import { Stripe } from "stripe";
import { useAuth } from "../../services/auth";
import { isCloud } from "../../services/env";

export const InviteModalBillingWarnings: FC<{
  subscriptionStatus: string;
  activeAndInvitedUsers: number;
  seatsInFreeTier: number;
  hasActiveSubscription: boolean;
  pricePerSeat: number;
  discountedPricePerSeat?: number;
  currentPaidSeats: number;
  email: string;
  organizationId;
}> = ({
  subscriptionStatus,
  activeAndInvitedUsers,
  seatsInFreeTier,
  hasActiveSubscription,
  pricePerSeat,
  discountedPricePerSeat,
  currentPaidSeats,
  email,
  organizationId,
}) => {
  const { apiCall } = useAuth();
  const [error, setError] = useState(null);

  const startStripeSubscription = async () => {
    setError(null);
    try {
      const resp = await apiCall<{
        status: number;
        session: Stripe.Checkout.Session;
      }>(`/subscription/checkout`, {
        method: "POST",
        body: JSON.stringify({
          qty:
            subscriptionStatus === "canceled"
              ? activeAndInvitedUsers
              : activeAndInvitedUsers + 1,
          email: email,
          organizationId: organizationId,
        }),
      });

      if (resp.session.url) {
        router.push(resp.session.url);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  if (!isCloud() || !seatsInFreeTier) return null;

  if (subscriptionStatus === "past_due")
    return (
      <p className="mt-3 mb-0 alert-danger alert">
        Whoops! Your bill is past due. Please update your billing info.
      </p>
    );

  if (subscriptionStatus === "canceled")
    return (
      <p className="mt-3 mb-0 alert-danger alert">
        Whoops! You don&apos;t have an active subscription. To add a new user,
        please{" "}
        <strong>
          <button
            type="button"
            className="btn btn-link p-0 align-baseline shadow-none"
            onClick={startStripeSubscription}
          >
            <strong>restart your subscription</strong>
          </button>
        </strong>
        .
      </p>
    );

  return (
    <>
      {activeAndInvitedUsers < seatsInFreeTier && (
        <p className="mt-3 mb-0 alert alert-info">{`You have ${
          seatsInFreeTier - activeAndInvitedUsers
        } free seat${
          seatsInFreeTier - activeAndInvitedUsers > 1 ? "s" : ""
        } remaining.`}</p>
      )}
      {activeAndInvitedUsers >= seatsInFreeTier &&
        currentPaidSeats <= activeAndInvitedUsers &&
        hasActiveSubscription && (
          <p className="mt-3 mb-0 alert-warning alert">
            This user will be assigned a new seat{" "}
            <strong>
              (${discountedPricePerSeat ? discountedPricePerSeat : pricePerSeat}
              /month)
            </strong>
            .
          </p>
        )}
      {activeAndInvitedUsers >= seatsInFreeTier && !hasActiveSubscription && (
        <p className="mt-3 mb-0 alert-warning alert">
          Whoops! You&apos;re currently in the <strong>Free Plan</strong> which
          only allows {seatsInFreeTier} seats. To add a seat (${pricePerSeat}
          /month), please{" "}
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
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
};
