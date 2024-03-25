import { FC, useState } from "react";
import LoadingOverlay from "@front-end/components/LoadingOverlay";
import SubscriptionInfo from "@front-end/components/Settings/SubscriptionInfo";
import { isCloud } from "@front-end/services/env";
import UpgradeModal from "@front-end/components/Settings/UpgradeModal";
import useStripeSubscription from "@front-end/hooks/useStripeSubscription";
import usePermissions from "@front-end/hooks/usePermissions";
import { useUser } from "@front-end/services/UserContext";

const BillingPage: FC = () => {
  const [upgradeModal, setUpgradeModal] = useState(false);

  const { canSubscribe, subscriptionStatus, loading } = useStripeSubscription();

  const permissions = usePermissions();

  const { accountPlan } = useUser();

  if (!isCloud()) {
    return (
      <div className="alert alert-info">
        This page is not available for self-hosted installations.
      </div>
    );
  }

  if (accountPlan === "enterprise") {
    return (
      <div className="container pagecontents">
        <div className="alert alert-info">
          This page is not available for enterprise customers. Please contact
          your account rep for any billing questions or changes.
        </div>
      </div>
    );
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  if (!permissions.manageBilling) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
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
