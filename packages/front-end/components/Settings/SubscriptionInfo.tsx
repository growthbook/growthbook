import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { datetime } from "../../services/dates";
import LoadingOverlay from "../LoadingOverlay";

const formatter = new Intl.NumberFormat();

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
}> = ({ qty, trialEnd, status }) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  return (
    <>
      <div className="row align-items-center">
        {loading && <LoadingOverlay />}
        <div className="col-auto mb-3">
          <strong>Status:</strong> {status}
        </div>
        {status === "trialing" && trialEnd && (
          <div className="col-md-12 mb-3">
            <strong>Trial Ends:</strong> {datetime(trialEnd)}
          </div>
        )}
        <div className="col-md-12 mb-3">
          <strong>Monthly Tracked Users:</strong> {formatter.format(qty * 1000)}
        </div>
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
