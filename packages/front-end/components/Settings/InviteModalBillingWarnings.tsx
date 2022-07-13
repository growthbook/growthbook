import { FC } from "react";
import router from "next/router";
import { Stripe } from "stripe";
import { useAuth } from "../../services/auth";
import { isCloud } from "../../services/env";

export const InviteModalBillingWarnings: FC<{
  status: string;
  currentNumOfSeats: number;
  numOfFreeSeats: number;
  hasActiveSubscription: boolean;
  pricePerSeat: number;
  totalSeats: number;
  email: string;
  organizationId;
}> = ({
  status,
  currentNumOfSeats,
  numOfFreeSeats,
  hasActiveSubscription,
  pricePerSeat,
  totalSeats,
  email,
  organizationId,
}) => {
  const { apiCall } = useAuth();
  const startStripeSubscription = async () => {
    const resp = await apiCall<{
      status: number;
      session: Stripe.Checkout.Session;
    }>(`/subscription/checkout`, {
      method: "POST",
      body: JSON.stringify({
        qty: totalSeats + 1,
        email: email,
        organizationId: organizationId,
      }),
    });

    if (resp.session.url) {
      router.push(resp.session.url);
    }
  };

  if (!isCloud()) return null;

  return (
    <>
      {status === "past_due" && (
        <p className="mt-3 mb-0 alert-danger alert">
          Whoops! Your bill is past due. Please update your billing info.
        </p>
      )}
      {currentNumOfSeats < numOfFreeSeats && (
        <p className="mt-3 mb-0 alert alert-info">{`You have ${
          numOfFreeSeats - currentNumOfSeats
        } free seat${
          numOfFreeSeats - currentNumOfSeats > 1 ? "s" : ""
        } remaining.`}</p>
      )}
      {currentNumOfSeats >= numOfFreeSeats &&
        totalSeats <= currentNumOfSeats &&
        hasActiveSubscription && (
          <p className="mt-3 mb-0 alert-warning alert">
            This user will be assigned a new seat{" "}
            <strong>(${pricePerSeat}/month)</strong>.
          </p>
        )}
      {totalSeats >= numOfFreeSeats && !hasActiveSubscription && (
        <p className="mt-3 mb-0 alert-warning alert">
          Whoops! You&apos;re currently in the <strong>Free Plan</strong> which
          only allows {numOfFreeSeats} seats. To add a seat (${pricePerSeat}
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
    </>
  );
};
