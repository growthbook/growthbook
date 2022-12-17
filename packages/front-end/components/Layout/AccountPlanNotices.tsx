import { useRouter } from "next/router";
import { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import usePermissions from "@/hooks/usePermissions";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { daysLeft } from "@/services/dates";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "../Settings/UpgradeModal";
import Tooltip from "../Tooltip/Tooltip";

export default function AccountPlanNotices() {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const permissions = usePermissions();
  const router = useRouter();
  const { license } = useUser();
  const {
    showSeatOverageBanner,
    canSubscribe,
    activeAndInvitedUsers,
    freeSeats,
    trialEnd,
    subscriptionStatus,
  } = useStripeSubscription();

  // GrowthBook Cloud-specific Notices
  if (isCloud() && permissions.manageBilling) {
    // On an active trial
    const trialRemaining = trialEnd ? daysLeft(trialEnd) : -1;
    if (subscriptionStatus === "trialing" && trialRemaining >= 0) {
      return (
        <button
          className="alert alert-warning py-1 px-2 mb-0 d-none d-md-block mr-1"
          onClick={(e) => {
            e.preventDefault();
            router.push("/settings/billing");
          }}
        >
          <div className="badge badge-warning">{trialRemaining}</div> day
          {trialRemaining === 1 ? "" : "s"} left in trial
        </button>
      );
    }
    // Payment past due
    if (subscriptionStatus === "past_due") {
      return (
        <button
          className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1"
          onClick={(e) => {
            e.preventDefault();
            router.push("/settings/billing");
          }}
        >
          <FaExclamationTriangle /> payment past due
        </button>
      );
    }

    // Over the free tier
    if (
      showSeatOverageBanner &&
      canSubscribe &&
      activeAndInvitedUsers > freeSeats
    ) {
      return (
        <>
          {upgradeModal && (
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              source="top-nav-freeseat-overage"
              reason="Whoops! You are over your free seat limit."
            />
          )}
          <button
            className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1"
            onClick={async (e) => {
              e.preventDefault();
              setUpgradeModal(true);
            }}
          >
            <FaExclamationTriangle /> free tier exceded
          </button>
        </>
      );
    }
  }

  // Self-hosted-specific Notices
  if (!isCloud() && license) {
    // Trial license is up
    const licenseTrialRemaining = license.trial ? daysLeft(license.exp) : -1;
    if (licenseTrialRemaining >= 0) {
      return (
        <Tooltip
          body={
            <>
              Contact sales@growthbook.io if you need more time or would like to
              upgrade
            </>
          }
        >
          <div className="alert alert-warning py-1 px-2 mb-0 d-none d-md-block mr-1">
            <span className="badge badge-warning">{licenseTrialRemaining}</span>{" "}
            day
            {licenseTrialRemaining === 1 ? "" : "s"} left in trial
          </div>
        </Tooltip>
      );
    }

    // License expired
    if (license.exp < new Date().toISOString().substring(0, 10)) {
      return (
        <Tooltip
          body={
            <>
              Your license expired on <strong>{license.exp}</strong>. Contact
              sales@growthbook.io to renew.
            </>
          }
        >
          <div className="alert alert-danger py-1 px-2 d-none d-md-block mb-0 mr-1">
            <FaExclamationTriangle /> license expired
          </div>
        </Tooltip>
      );
    }

    // More seats than the license allows for
    if (activeAndInvitedUsers > license.qty) {
      return (
        <Tooltip
          body={
            <>
              Your license is valid for <strong>{license.qty} seats</strong>,
              but you are currently using{" "}
              <strong>{activeAndInvitedUsers}</strong>. Contact
              sales@growthbook.io to extend your quota.
            </>
          }
        >
          <div className="alert alert-danger py-1 px-2 d-none d-md-block mb-0 mr-1">
            <FaExclamationTriangle /> license quota exceded
          </div>
        </Tooltip>
      );
    }
  }

  return null;
}
