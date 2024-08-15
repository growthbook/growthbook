import { useState } from "react";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { redirectWithTimeout, useAuth } from "@front-end/services/auth";
import useStripeSubscription from "@front-end/hooks/useStripeSubscription";
import LoadingOverlay from "@front-end/components/LoadingOverlay";
import Button from "@front-end/components/Button";
import UpgradeModal from "./UpgradeModal";

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    hasPaymentMethod,
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
        <strong>Current Plan:</strong> Cloud Pro
        {subscriptionStatus === "trialing" && (
          <>
            {" "}
            <em>(trial)</em>
          </>
        )}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Number Of Seats:</strong> {quote?.activeAndInvitedUsers || 0}
      </div>
      {subscriptionStatus !== "canceled" && !pendingCancelation && (
        <div className="col-md-12 mb-3">
          <div>
            <strong>Next Bill Date: </strong>
            {nextBillDate}
          </div>
          {hasPaymentMethod === true ? (
            <div
              className="mt-3 px-3 py-2 alert alert-success row"
              style={{ maxWidth: 650 }}
            >
              <div className="col-auto px-1">
                <FaCheckCircle />
              </div>
              <div className="col">
                You have a valid payment method on file. You will be billed
                automatically on this date.
              </div>
            </div>
          ) : hasPaymentMethod === false ? (
            <div
              className="mt-3 px-3 py-2 alert alert-warning row"
              style={{ maxWidth: 550 }}
            >
              <div className="col-auto px-1">
                <FaExclamationTriangle />
              </div>
              <div className="col">
                <p>
                  You do not have a valid payment method on file. Your
                  subscription will be cancelled on this date unless you add a
                  valid payment method.
                </p>
                <p className="mb-0">
                  Click <strong>View Plan Details</strong> below to add a
                  payment method.
                </p>
              </div>
            </div>
          ) : null}
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
      <div className="col-md-12 mt-4 mb-3 d-flex flex-row px-0">
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
              ? "View Plan Details"
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
      {/* @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'. */}
      {quote.currentSeatsPaidFor !== activeAndInvitedUsers && (
        <div className="col-md-12 mb-3 alert alert-warning">
          {`You have recently ${
            // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
            activeAndInvitedUsers - quote.currentSeatsPaidFor > 0
              ? "added"
              : "removed"
          } ${Math.abs(
            // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
            activeAndInvitedUsers - quote.currentSeatsPaidFor
          )} seats. `}
          These changes will be applied to your subscription soon.
        </div>
      )}
    </>
  );
}
