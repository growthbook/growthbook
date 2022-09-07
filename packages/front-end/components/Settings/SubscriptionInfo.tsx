import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip";
import useStripeSubscription from "../../hooks/useStripeSubscription";
import Button from "../Button";
import { useState } from "react";
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
    organization,
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
        <strong>Number Of Seats:</strong> {quote?.qty || 0}
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
                window.location.href = res.url;
                // Allow 5 seconds for the redirect to finish
                await new Promise((resolve) => setTimeout(resolve, 5000));
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
      {activeAndInvitedUsers !==
        (organization.members.length + organization.invites.length || 0) && (
        <div className="col-md-12 mb-3 alert alert-warning">
          Your subscription has pending changes that will be applied soon.
        </div>
      )}
    </>
  );
}
