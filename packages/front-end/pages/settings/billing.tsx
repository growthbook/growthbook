import { FC, useEffect, useState } from "react";
import { LicenseInterface } from "enterprise";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import SubscriptionInfo from "@/components/Settings/SubscriptionInfo";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Billing/CloudUsage";
import { isCloud } from "@/services/env";

const BillingPage: FC = () => {
  const [upgradeModal, setUpgradeModal] = useState(false);

  const { canSubscribe, subscriptionStatus, loading } = useStripeSubscription();

  const permissionsUtil = usePermissionsUtil();

  const router = useRouter();
  const useDummyUsageData = !!router.query.dummy;

  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  useEffect(() => {
    const refreshLicense = async () => {
      const res = await apiCall<{
        status: number;
        license: LicenseInterface;
      }>(`/license`, {
        method: "GET",
      });

      if (res.status !== 200) {
        throw new Error("There was an error fetching the license");
      }
      refreshOrganization();
    };

    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      // TODO: Get rid of the "org" route, once all license data has been moved off the orgs
      if (urlParams.get("refreshLicense") || urlParams.get("org")) {
        refreshLicense();
      }
    }
  }, [apiCall, refreshOrganization]);

  if (loading) {
    return <LoadingOverlay />;
  }

  if (!permissionsUtil.canManageBilling()) {
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

      <h1 className="mb-3">Billing and Usage</h1>

      {(isCloud() || useDummyUsageData) && <CloudUsage />}

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
