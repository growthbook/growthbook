import { useState } from "react";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip/Tooltip";
import Button from "../Button";
import UpgradeModal from "./UpgradeModal";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    quote,
    loading,
    canSubscribe,
    activeAndInvitedUsers,
  } = useStripeSubscription();

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (loading) return <LoadingOverlay />;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason="Your subscription has expired."
          source="billing-renew"
        />
      )}
      <div className="col-auto mb-3">
        <strong>Current Plan:</strong> {planName}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Number Of Seats:</strong> {quote?.currentSeatsPaidFor || 0}
      </div>
      {quote && (
        <div className="col-md-12 mb-3">
          <strong>Current Monthly Price:</strong>{" "}
          {` ${currencyFormatter.format(quote.total || 0)}/month`}{" "}
          <Tooltip
            body="Click the Manage Subscription button below to see how this is calculated."
            tipMinWidth="200px"
          />
        </div>
      )}
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
          <Button
            color="primary"
            onClick={async () => {
              const res = await apiCall<{ url: string }>(
                `/subscription/manage`,
                {
                  method: "POST",
                }
              );
              if (res && res.url) {
                await redirectWithTimeout(res.url);
              } else {
                throw new Error("Unknown response");
              }
            }}
          >
            {subscriptionStatus !== "canceled"
              ? "Manage Subscription"
              : "View Previous Invoices"}
          </Button>
        </div>
        {subscriptionStatus === "canceled" && canSubscribe && (
          <div className="col-auto">
            <button
              className="btn btn-success"
              onClick={(e) => {
                e.preventDefault();
                setUpgradeModal(true);
              }}
            >
              Renew Your Plan
            </button>
          </div>
        )}
      </div>
      {quote.currentSeatsPaidFor !== activeAndInvitedUsers && (
        <div className="col-md-12 mb-3 alert alert-warning">
          {`You have recently ${
            activeAndInvitedUsers - quote.currentSeatsPaidFor > 0
              ? "added"
              : "removed"
          } ${Math.abs(
            activeAndInvitedUsers - quote.currentSeatsPaidFor
          )} seats. `}
          These changes will be applied to your subscription soon.
        </div>
      )}
    </>
  );
}
