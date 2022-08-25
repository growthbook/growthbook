import Link from "next/link";
import { FC, useState } from "react";
import { FaAngleLeft } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import SubscriptionInfo from "../../components/Settings/SubscriptionInfo";
import { isCloud } from "../../services/env";
import UpgradeModal from "../../components/Settings/UpgradeModal";
import useStripeSubscription from "../../hooks/useStripeSubscription";

const BillingPage: FC = () => {
  const [upgradeModal, setUpgradeModal] = useState(false);

  const { canSubscribe, subscriptionStatus, loading } = useStripeSubscription();

  if (!isCloud()) {
    return (
      <div className="alert alert-info">
        This page is not available for self-hosted installations.
      </div>
    );
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="billing-free"
        />
      )}

      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Billing Settings</h1>
      <div className=" bg-white p-3 border">
        {subscriptionStatus ? (
          <SubscriptionInfo />
        ) : canSubscribe ? (
          <div className="alert alert-warning mb-0">
            <div className="d-flex align-items-center">
              <div>
                You are currently on the <strong>Free Plan</strong>.
              </div>
              <button
                className="btn btn-primary ml-auto"
                onClick={(e) => {
                  e.preventDefault();
                  setUpgradeModal(true);
                }}
              >
                Upgrade Now
              </button>
            </div>
          </div>
        ) : (
          <p>
            Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
            to make changes to your subscription plan.
          </p>
        )}
      </div>
    </div>
  );
};
export default BillingPage;
