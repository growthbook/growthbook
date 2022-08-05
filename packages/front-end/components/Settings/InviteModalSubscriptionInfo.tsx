import { FC, useState } from "react";
import router from "next/router";
import { Stripe } from "stripe";
import { useAuth } from "../../services/auth";
import { isCloud } from "../../services/env";

export const InviteModalSubscriptionInfo: FC<{
  subscriptionStatus: string;
  activeAndInvitedUsers: number;
  freeSeats: number;
  hasActiveSubscription: boolean;
  pricePerSeat: number;
  currentPaidSeats: number;
}> = ({
  subscriptionStatus,
  activeAndInvitedUsers,
  freeSeats,
  hasActiveSubscription,
  pricePerSeat,
  currentPaidSeats,
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
          qty: activeAndInvitedUsers,
        }),
      });

      if (resp.session.url) {
        router.push(resp.session.url);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  if (!isCloud()) return null;

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
      {activeAndInvitedUsers < freeSeats && (
        <p className="mt-3 mb-0 alert alert-info">{`You have ${
          freeSeats - activeAndInvitedUsers
        } free seat${
          freeSeats - activeAndInvitedUsers > 1 ? "s" : ""
        } remaining.`}</p>
      )}
      {activeAndInvitedUsers >= freeSeats &&
        currentPaidSeats <= activeAndInvitedUsers &&
        hasActiveSubscription && (
          <p className="mt-3 mb-0 alert-warning alert">
            This user will be assigned a new seat{" "}
            {pricePerSeat && (
              <strong>
                (${pricePerSeat}
                /month).
              </strong>
            )}
          </p>
        )}
      {activeAndInvitedUsers >= freeSeats && !hasActiveSubscription && (
        <p className="mt-3 mb-0 alert-warning alert">
          Whoops! You&apos;re currently in the <strong>Free Plan</strong> which
          only allows {freeSeats} seats. To add additional seats please{" "}
          <strong>
            <button
              type="button"
              className="btn btn-link p-0 align-baseline shadow-none"
              onClick={startStripeSubscription}
            >
              <strong>start a subscription</strong>
            </button>
          </strong>
          .
        </p>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
};
