import { useState } from "react";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import Button from "@/components/Button";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import Modal from "../Modal";
import Callout from "../Radix/Callout";
import UpgradeModal from "./UpgradeModal";

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    subscription,
    seatsInUse,
    canSubscribe,
    accountPlan,
    users,
    refreshOrganization,
  } = useUser();

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [cancelSubscriptionModal, setCancelSubscriptionModal] = useState(false);

  // Orb subscriptions only count members, not members + invites like Stripe Subscriptions
  const subscriptionSeats =
    subscription?.billingPlatform === "orb" ? users.size : seatsInUse;

  const hasActiveOrbSubscription =
    subscription?.billingPlatform === "orb" &&
    subscription?.status === "active" &&
    subscription?.nextBillDate &&
    !subscription?.pendingCancelation;

  return (
    <div className="p-3">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="billing-renew"
          commercialFeature={null}
        />
      )}
      {cancelSubscriptionModal && (
        <Modal
          open={true}
          header="Are you sure you want to cancel?"
          trackingEventModalType="cancel-subscription"
          close={() => setCancelSubscriptionModal(false)}
          cta="Yes, Cancel Subscription"
          closeCta="Keep Subscription"
          submitColor="danger"
          submit={async () => {
            await apiCall("/subscription/cancel", { method: "POST" });
            refreshOrganization();
          }}
        >
          <>
            <p>
              If you cancel, you will continue to have access to your
              <strong> {planNameFromAccountPlan(accountPlan)} Plan </strong>
              features until your current billing period ends on{" "}
              {subscription?.nextBillDate}.
            </p>
            <Callout status="warning">
              You account can still accrue CDN usage charges. If you&apos;d like
              to prevent that, you can remove Growthbook SDK from your code
              base.
            </Callout>
          </>
        </Modal>
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
        <strong>Number Of Seats:</strong> {subscriptionSeats || 0}
      </div>
      {subscription?.status !== "canceled" &&
        !subscription?.pendingCancelation && (
          <div className="col-md-12 mb-3">
            <div>
              <strong>Next Bill Date: </strong>
              {subscription?.nextBillDate}
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
      {subscription?.pendingCancelation && subscription?.dateToBeCanceled && (
        <div className="col-md-12 mb-3 alert alert-danger">
          Your plan will be canceled, but is still available until the end of
          your billing period on
          {` ${subscription?.dateToBeCanceled}.`}
        </div>
      )}
      {subscription?.status === "canceled" && (
        <div className="col-md-12 mb-3 alert alert-danger">
          Your plan was canceled on {` ${subscription?.cancelationDate}.`}
        </div>
      )}
      <div className="col-md-12 mt-4 mb-3 d-flex flex-row px-0">
        {subscription?.billingPlatform === "stripe" ? (
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
        ) : null}
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
        {hasActiveOrbSubscription ? (
          <Button
            onClick={() => setCancelSubscriptionModal(true)}
            color="danger"
          >
            Cancel Subscription
          </Button>
        ) : null}
      </div>
    </div>
  );
}
