import { useEffect, useState } from "react";
import { AccountPlan } from "back-end/types/organization";
import useStripeSubscription from "../../../hooks/useStripeSubscription";
import { redirectWithTimeout, useAuth } from "../../../services/auth";
import track from "../../../services/track";
import LoadingOverlay from "../../LoadingOverlay";
import Tooltip from "../../Tooltip/Tooltip";
import Button from "../../Button";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export default function CloudUpgradeForm({
  accountPlan,
  source,
  reason,
}: {
  accountPlan: AccountPlan;
  source: string;
  reason: string;
  setCloseCta: (string) => void;
  close: () => void;
}) {
  const { quote, loading } = useStripeSubscription();
  const { apiCall } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    track("View Upgrade Modal", {
      accountPlan,
      source,
      qty: quote?.activeAndInvitedUsers || 0,
      unitPrice: quote?.unitPrice || 0,
      discountAmount: quote?.discountAmount || 0,
      discountMessage: quote?.discountMessage || "",
      subtotal: quote?.subtotal,
      total: quote?.total,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startStripeSubscription = async () => {
    setError(null);
    try {
      const resp = await apiCall<{
        status: number;
        session?: { url?: string };
      }>(`/subscription/checkout`, {
        method: "POST",
        body: JSON.stringify({
          qty: quote?.activeAndInvitedUsers || 0,
          returnUrl: window.location.pathname,
        }),
      });

      if (resp.session?.url) {
        track("Start Checkout", {
          source,
          accountPlan,
          qty: quote?.activeAndInvitedUsers || 0,
          unitPrice: quote?.unitPrice || 0,
          discountAmount: quote?.discountAmount || 0,
          discountMessage: quote?.discountMessage || "",
          subtotal: quote?.subtotal,
          total: quote?.total,
        });
        await redirectWithTimeout(resp.session.url);
      } else {
        setError("Failed to start checkout");
      }
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {loading && <LoadingOverlay />}
      <p className="text-center mb-4" style={{ fontSize: "1.5em" }}>
        {reason} Upgrade to a <strong>Pro Plan</strong>
      </p>
      <p className="text-center mb-4">
        After upgrading, you will be able to add additional users for{" "}
        <strong>
          {currencyFormatter.format(quote?.additionalSeatPrice || 0)}
        </strong>
        /month.
      </p>
      <div className="row align-items-center justify-content-center">
        <div className="col-auto mb-4 mr-lg-5 pr-lg-5">
          <h3>Pro Plan includes:</h3>
          <ul className="mb-3 pl-3">
            <li>Up to 100 team members</li>
            <li>
              Advanced permissioning{" "}
              <Tooltip
                body={
                  <>
                    Let someone toggle a feature in dev, but not production.
                    <br />
                    Or make them read-only in Project A and an admin for Project
                    B.
                  </>
                }
              />
            </li>
            <li>
              Custom fields*{" "}
              <Tooltip
                body={
                  "Add custom fields to experiments and features for structured documentation and easy searching. Coming soon."
                }
              />
            </li>
            <li>
              Premium support{" "}
              <Tooltip
                body={
                  "Shared Slack channel with our engineering team to quickly help with any issues."
                }
              />
            </li>
            <li>
              Encrypt SDK endpoint response{" "}
              <Tooltip
                body={
                  "Prevent your users from inspecting your feature flags and experiments when using client-side and mobile SDKs"
                }
              />
            </li>
            <li>Early access to new features</li>
          </ul>
        </div>
        <div className="col-auto mb-4">
          <div className="bg-light border rounded p-3 p-lg-4">
            <div className="d-flex">
              <div>Current team size</div>
              <div className="ml-auto">
                <strong>{quote?.activeAndInvitedUsers || 0}</strong> users
              </div>
            </div>
            <div className="d-flex border-bottom py-2 mb-2">
              <div>Price per user</div>
              <div className="ml-auto">
                <strong>
                  {currencyFormatter.format(quote?.unitPrice || 0)}
                </strong>
                <small className="text-muted"> / month</small>
              </div>
            </div>
            {quote?.discountAmount < 0 && quote?.discountMessage && (
              <div className="d-flex border-bottom py-2 mb-2">
                <div>{quote.discountMessage}</div>
                <div className="ml-auto">
                  <strong className="text-danger">
                    {currencyFormatter.format(quote.discountAmount)}
                  </strong>
                  <small className="text-muted"> / month</small>
                </div>
              </div>
            )}
            <div className="d-flex py-2 mb-3" style={{ fontSize: "1.3em" }}>
              <div>Total</div>
              <div className="ml-auto">
                <strong>{currencyFormatter.format(quote?.total || 0)}</strong>
                <small className="text-muted"> / month</small>
              </div>
            </div>
            <div className="text-center px-4 mb-2">
              <Button
                color="primary"
                className="btn-block btn-lg"
                onClick={startStripeSubscription}
              >
                Upgrade to Pro
              </Button>
            </div>
            <div
              className="text-center text-muted"
              style={{ fontSize: "0.8em" }}
            >
              Cancel or modify your subscription anytime.
            </div>
          </div>
        </div>
      </div>
      <p className="text-center">
        Interested in an Enterprise plan instead? Contact us at{" "}
        <a
          href="mailto:sales@growthbook.io"
          onClick={() => {
            track("Click Enterprise Upgrade Link", {
              accountPlan,
              source,
              qty: quote?.activeAndInvitedUsers || 0,
              unitPrice: quote?.unitPrice || 0,
              discountAmount: quote?.discountAmount || 0,
              discountMessage: quote?.discountMessage || "",
              subtotal: quote?.subtotal,
              total: quote?.total,
            });
          }}
        >
          sales@growthbook.io
        </a>{" "}
        for a custom quote.
      </p>
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
}
