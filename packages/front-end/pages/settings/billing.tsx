import { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { LicenseInterface } from "shared/enterprise";
import SubscriptionInfo from "@/components/Settings/SubscriptionInfo";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PaymentInfo from "@/enterprise/components/Billing/PaymentInfo";
import OrbPortal from "@/enterprise/components/Billing/OrbPortal";
import { isCloud } from "@/services/env";

const BillingPage: FC = () => {
  const [upgradeModal, setUpgradeModal] = useState(false);

  const permissionsUtil = usePermissionsUtil();

  const { accountPlan, subscription, canSubscribe } = useUser();

  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  const router = useRouter();

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

      if (urlParams.get("openUpgradeModal")) {
        setUpgradeModal(true);

        // Remove the query param from the URL
        router.replace(router.pathname, undefined, { shallow: true });
      }
    }
  }, [apiCall, refreshOrganization, router]);

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

  if (!permissionsUtil.canManageBilling()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  if (subscription?.isVercelIntegration) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-info">
          This page is not available for organizations whose plan is managed by
          Vercel. Please go to your Vercel Integration Dashboard for any billing
          information. If you&apos;d like to cancel your subscription, you can
          do so in the GrowthBook Integration Dashboard in Vercel.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="billing-free"
          commercialFeature={null}
        />
      )}
      <h1>Plan Info</h1>
      <div className="appbox p-3 border">
        {subscription?.status ? (
          <SubscriptionInfo />
        ) : canSubscribe ? (
          <div className="bg-white p-3">
            <div className="alert alert-warning mb-0">
              <div className="d-flex align-items-center">
                <div>
                  You are currently on the <strong>Starter Plan</strong>.
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
          </div>
        ) : (
          <p>
            Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
            to make changes to your subscription plan.
          </p>
        )}
      </div>
      {subscription?.status ? (
        <>
          <PaymentInfo />
          {isCloud() && subscription?.billingPlatform === "orb" ? (
            <OrbPortal />
          ) : null}
        </>
      ) : null}
    </div>
  );
};
export default BillingPage;
