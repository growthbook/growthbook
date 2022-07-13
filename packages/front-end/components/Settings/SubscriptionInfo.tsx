import { FC, useState, useEffect } from "react";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip";

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
      const { subscription } = await apiCall(`/subscription`);
      setSubscriptionData(subscription);
    };

    getSubscriptionData();
  }, []);

  if (!subscriptionData) return <LoadingOverlay />;

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
          {`$${(qty - 5) * subscriptionData.plan.metadata.price}`}
          <Tooltip
            text={`Your first ${subscriptionData.plan.metadata.freeSeats} seats are free. And each additional seat is $${subscriptionData.plan.metadata.price}/month.`}
            tipMinWidth="200px"
          />
        </div>
        <div className="col-md-12 mb-3">
          <strong>Next Bill Date:</strong>{" "}
          {new Date(subscriptionData.current_period_end * 1000).toDateString()}
        </div>
        {subscriptionData.cancel_at_period_end && subscriptionData.cancel_at && (
          <div className="col-md-12 mb-3 alert alert-danger">
            Your plan will be canceled, but is still available until the end of
            of your billing period on
            {` ${new Date(subscriptionData.cancel_at * 1000).toDateString()}.`}
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
