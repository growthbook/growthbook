import { FC, useState, useEffect } from "react";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip";
import { Stripe } from "stripe";
import useApi from "../../hooks/useApi";
import { SettingsApiResponse } from "../../pages/settings";
import useUser from "../../hooks/useUser";

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
  const [subscriptionData, setSubscriptionData] = useState(null);
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const { email } = useUser();

  const currentNumOfSeats =
    data.organization.members.length + data.organization.invites.length;

  useEffect(() => {
    const getSubscriptionData = async () => {
      const { subscription } = await apiCall(`/subscription`);
      setSubscriptionData(subscription);
    };

    getSubscriptionData();
  }, []);

  if (!subscriptionData) return <LoadingOverlay />;

  const numOfFreeSeats = subscriptionData?.plan.metadata.freeSeats || 5;

  return (
    <>
      <div className="row align-items-center">
        <div className="col-auto mb-3">
          <strong>Current Plan:</strong> {subscriptionData.plan.nickname}
        </div>
        <div className="col-md-12 mb-3">
          <strong>Number Of Seats:</strong> {qty}
        </div>
        <div className="col-md-12 mb-3">
          <strong>Current Monthly Price:</strong>{" "}
          {qty > numOfFreeSeats
            ? `$${
                (qty - numOfFreeSeats) * subscriptionData.plan.metadata.price
              }`
            : "$0"}
          <Tooltip
            text={`Your first ${subscriptionData.plan.metadata.freeSeats} seats are free. And each additional seat is $${subscriptionData.plan.metadata.price}/month.`}
            tipMinWidth="200px"
          />
        </div>
        {subscriptionData.status !== "canceled" && (
          <div className="col-md-12 mb-3">
            <strong>Next Bill Date:</strong>{" "}
            {new Date(
              subscriptionData.current_period_end * 1000
            ).toDateString()}
          </div>
        )}
        {subscriptionData.cancel_at_period_end && subscriptionData.cancel_at && (
          <div className="col-md-12 mb-3 alert alert-danger">
            Your plan will be canceled, but is still available until the end of
            of your billing period on
            {` ${new Date(subscriptionData.cancel_at * 1000).toDateString()}.`}
          </div>
        )}
        {subscriptionData.status === "canceled" && (
          <div className="col-md-12 mb-3 alert alert-danger">
            Your plan was canceled on{" "}
            {` ${new Date(
              subscriptionData.canceled_at * 1000
            ).toDateString()}.`}
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
              {subscriptionData.status !== "canceled"
                ? "Manage Subscription"
                : "View Previous Invoices"}
            </button>
          </div>
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
                      qty: currentNumOfSeats,
                      email: email,
                      organizationId: data.organization.id,
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
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
};

export default SubscriptionInfo;
