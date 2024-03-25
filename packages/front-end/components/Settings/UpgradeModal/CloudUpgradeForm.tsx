import { useEffect, useState } from "react";
import { AccountPlan } from "enterprise";
import { useUser } from "@/services/UserContext";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingOverlay from "@/components/LoadingOverlay";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export default function CloudUpgradeForm({
  accountPlan,
  source,
}: {
  accountPlan: AccountPlan;
  source: string;
  setCloseCta: (string) => void;
  close: () => void;
}) {
  const { quote, loading } = useStripeSubscription();
  const { apiCall } = useAuth();
  const { organization } = useUser();
  const [error, setError] = useState(null);

  const freeTrialAvailable = !organization.freeTrialDate;

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
          isFreeTrial: freeTrialAvailable,
        });
        await redirectWithTimeout(resp.session.url);
      } else {
        // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"Failed to start checkout"' is n... Remove this comment to see the full error message
        setError("Failed to start checkout");
      }
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {loading && <LoadingOverlay />}
      {freeTrialAvailable ? (
        <>
          <p className="text-center mb-4" style={{ fontSize: "1.5em" }}>
            Try <strong>GrowthBook Pro</strong> free for 14 days
          </p>
          <p className="text-center mb-4">No credit card required</p>
        </>
      ) : (
        <>
          <p className="text-center mb-4" style={{ fontSize: "1.5em" }}>
            Upgrade to a <strong>Pro Plan</strong>
          </p>
          <p className="text-center mb-4">
            After upgrading, you will be able to add additional users for{" "}
            <strong>
              {currencyFormatter.format(quote?.additionalSeatPrice || 0)}
            </strong>
            /month.
          </p>
        </>
      )}
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
              Visual A/B test editor{" "}
              <Tooltip
                body={
                  "A/B test UI changes using our Visual Editor browser plugin without writing code."
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
            <li>
              Advanced experimentation features
              <br />
              (CUPED, Sequential Testing, etc)
            </li>
            <li>Early access to new features</li>
          </ul>
        </div>
        <div className="col-lg-5 mb-4">
          <div className="bg-light border rounded p-3 p-lg-4">
            <div className="d-flex">
              <div>Current team size</div>
              <div className="ml-auto">
                <strong>{quote?.activeAndInvitedUsers || 0}</strong> users
              </div>
            </div>
            {freeTrialAvailable ? (
              <div className="d-flex border-bottom py-2 mb-2">
                <div>Price per user</div>
                <div className="ml-auto text-right">
                  <div>
                    <strong
                      className="text-warning-orange"
                      style={{ textDecoration: "line-through" }}
                    >
                      {currencyFormatter.format(quote?.unitPrice || 0)}
                    </strong>
                    <small className="text-muted"> / month</small>
                  </div>
                  <strong>{currencyFormatter.format(0)}</strong>
                  <small className="text-muted"> / month</small>
                </div>
              </div>
            ) : (
              <div className="d-flex border-bottom py-2 mb-2">
                <div>Price per user</div>
                <div className="ml-auto">
                  <strong>
                    {currencyFormatter.format(quote?.unitPrice || 0)}
                  </strong>
                  <small className="text-muted"> / month</small>
                </div>
              </div>
            )}
            {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
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
            {freeTrialAvailable ? (
              <>
                <div className="d-flex pt-2 mb-2" style={{ fontSize: "1.3em" }}>
                  <div>Total</div>
                  <div className="ml-auto">
                    <strong>{currencyFormatter.format(0)}</strong>
                  </div>
                </div>
                <div className="pb-2 mt-2 mb-3 small">
                  You will <strong>not be charged</strong> after your trial ends
                  unless you opt in <sup>&#10019;</sup>
                </div>
              </>
            ) : (
              <div className="d-flex py-2 mb-3" style={{ fontSize: "1.3em" }}>
                <div>Total</div>
                <div className="ml-auto">
                  <strong>{currencyFormatter.format(quote?.total || 0)}</strong>
                  <small className="text-muted"> / month</small>
                </div>
              </div>
            )}
            <div className="text-center px-4 mb-2">
              <Button
                color="primary"
                className="btn-block btn-lg"
                onClick={startStripeSubscription}
              >
                {freeTrialAvailable ? "Start Free Trial" : "Upgrade to Pro"}
              </Button>
            </div>
            <div
              className="text-center text-muted"
              style={{ fontSize: "0.7em" }}
            >
              Cancel or modify your subscription at any time.
            </div>
            {freeTrialAvailable && (
              <div
                className="mt-2 text-center text-muted"
                style={{ fontSize: "0.7em", lineHeight: 1.2 }}
              >
                &#10019; You may opt to continue your subscription at the rate
                of{" "}
                <strong>
                  {currencyFormatter.format(quote?.total || 0)} / month
                </strong>{" "}
                by adding a credit card to your account.
              </div>
            )}
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
