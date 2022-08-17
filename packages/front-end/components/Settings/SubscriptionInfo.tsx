import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip";
import { Stripe } from "stripe";
import useStripeSubscription from "../../hooks/useStripeSubscription";

const SubscriptionInfo: FC<{
  id: string;
  qty: number;
  trialEnd: Date;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid";
}> = ({ qty }) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const {
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    monthlyPrice,
    activeAndInvitedUsers,
  } = useStripeSubscription();

  if (!planName || !activeAndInvitedUsers) return <LoadingOverlay />;

  return (
    <>
      <div className="col-auto mb-3">
        <strong>Current Plan:</strong> {planName}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Number Of Seats:</strong> {qty}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Current Monthly Price:</strong> {`  $${monthlyPrice}/month`}
        <Tooltip
          body="Click the Manage Subscription button below to see how this is calculated."
          tipMinWidth="200px"
        />
      </div>
      {subscriptionStatus !== "canceled" && !pendingCancelation && (
        <div className="col-md-12 mb-3">
          <strong>Next Bill Date: </strong>
          {nextBillDate}
        </div>
      )}
      {pendingCancelation && dateToBeCanceled && (
        <div className="col-md-12 mb-3 alert alert-danger">
          Your plan will be canceled, but is still available until the end of
          your billing period on
          {` ${dateToBeCanceled}.`}
        </div>
      )}
      {subscriptionStatus === "canceled" && (
        <div className="col-md-12 mb-3 alert alert-danger">
          Your plan was canceled on {` ${cancelationDate}.`}
        </div>
      )}
      <div className="col-md-12 mb-3 d-flex flex-row">
        <div className="col-auto">
          <button
            className="btn btn-primary"
            onClick={async (e) => {
              e.preventDefault();
              if (loading) return;
              setLoading(true);
              setError(null);
              try {
                const res = await apiCall<{ url: string }>(
                  `/subscription/manage`,
                  {
                    method: "POST",
                  }
                );
                if (res && res.url) {
                  window.location.href = res.url;
                  return;
                } else {
                  throw new Error("Unknown response");
                }
              } catch (e) {
                setError(e.message);
              }
              setLoading(false);
            }}
          >
            {subscriptionStatus !== "canceled"
              ? "Manage Subscription"
              : "View Previous Invoices"}
          </button>
        </div>
        {subscriptionStatus === "canceled" && (
          <div className="col-auto">
            <button
              className="btn btn-success"
              onClick={async (e) => {
                e.preventDefault();
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

                  if (resp && resp.session.url) {
                    window.location.href = resp.session.url;
                    return;
                  } else {
                    throw new Error("Unknown response");
                  }
                } catch (e) {
                  setError(e.message);
                }
                setLoading(false);
              }}
            >
              Renew Your Plan
            </button>
          </div>
        )}
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
};

export default SubscriptionInfo;
