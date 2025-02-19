import { useState } from "react";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import Button from "@/components/Button";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "./UpgradeModal";

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    subscription,
    seatsInUse,
    canSubscribe,
    organization,
    license,
  } = useUser();

  const [upgradeModal, setUpgradeModal] = useState(false);

  //TODO: Remove this once we have moved the license off the organization
  const stripeSubscription =
    license?.stripeSubscription || organization?.subscription;

  const nextBillDate = new Date(
    (stripeSubscription?.current_period_end || 0) * 1000
  ).toDateString();

  const dateToBeCanceled = new Date(
    (stripeSubscription?.cancel_at || 0) * 1000
  ).toDateString();

  const cancelationDate = new Date(
    (stripeSubscription?.canceled_at || 0) * 1000
  ).toDateString();

  const pendingCancelation =
    stripeSubscription?.status !== "canceled" &&
    stripeSubscription?.cancel_at_period_end;

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
        <strong>Current Plan:</strong> {isCloud() ? "Cloud" : "Self-Hosted"} Pro
        {subscription?.status === "trialing" && (
          <>
            {" "}
            <em>(trial)</em>
          </>
        )}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Number Of Seats:</strong> {seatsInUse || 0}
      </div>
      {subscription?.status !== "canceled" && !pendingCancelation && (
        <div className="col-md-12 mb-3">
          <div>
            <strong>Next Bill Date: </strong>
            {nextBillDate}
          </div>
          {subscription?.hasPaymentMethod === true ? (
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
          ) : subscription?.hasPaymentMethod === false ? (
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
      {subscription?.status === "canceled" && (
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
            {subscription?.status !== "canceled"
              ? "View Plan Details"
              : "View Previous Invoices"}
          </Button>
        </div>
        {subscription?.status === "canceled" && canSubscribe && (
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
    </>
  );
}
