import { FC, useState, useEffect } from "react";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";

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

  useEffect(() => {
    const getSubscriptionData = async () => {
      const res = await apiCall(`/subscription`, {
        method: "GET",
      });
      setSubscriptionData(res);
    };

    getSubscriptionData();
  }, []);

  if (!subscriptionData) return <LoadingOverlay />;

  console.log(subscriptionData);

  return (
    <>
      <div className="row align-items-center">
        <div className="col-auto mb-3">
          <strong>Current Plan:</strong>{" "}
          {subscriptionData.subscription.plan.nickname}
        </div>
        <div className="col-md-12 mb-3">
          <strong>Number Of Seats:</strong> {qty}
        </div>
        <div className="col-md-12 mb-3">
          <strong>Current Monthly Price:</strong>{" "}
          {`$${(qty - 5) * subscriptionData.subscription.plan.metadata.price}`}
        </div>
        <div className="col-md-12 mb-3">
          <strong>Next Bill Date:</strong>{" "}
          {new Date(
            subscriptionData.subscription.current_period_end * 1000
          ).toDateString()}
        </div>
        {subscriptionData.subscription.cancel_at_period_end &&
          subscriptionData.subscription.cancel_at && (
            <div className="col-md-12 mb-3 alert alert-danger">
              Your plan will be canceled, but is still available until the end
              of your billing period on
              {` ${new Date(
                subscriptionData.subscription.cancel_at * 1000
              ).toDateString()}.`}
            </div>
          )}
        <div className="col-md-12 mb-3">
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
            Manage Subscription
          </button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
};

export default SubscriptionInfo;
