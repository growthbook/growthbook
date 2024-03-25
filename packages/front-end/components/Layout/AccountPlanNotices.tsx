import { useRouter } from "next/router";
import { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { date, daysLeft } from "shared/dates";
import usePermissions from "@front-end/hooks/usePermissions";
import useStripeSubscription from "@front-end/hooks/useStripeSubscription";
import { isCloud } from "@front-end/services/env";
import { useUser } from "@front-end/services/UserContext";
import UpgradeModal from "@front-end/components/Settings/UpgradeModal";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

export default function AccountPlanNotices() {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const permissions = usePermissions();
  const router = useRouter();
  const { license, organization } = useUser();
  const {
    showSeatOverageBanner,
    canSubscribe,
    activeAndInvitedUsers,
    freeSeats,
    trialEnd,
    subscriptionStatus,
  } = useStripeSubscription();

  if (
    license?.message &&
    (license.message.showAllUsers || permissions.manageBilling)
  ) {
    return (
      <Tooltip body={<>{license.message.tooltipText}</>}>
        <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
          <FaExclamationTriangle /> {license.message.text}
        </div>
      </Tooltip>
    );
  }

  // GrowthBook Cloud-specific Notices
  // TODO: Get rid of this logic once we have migrated all organizations to use the license key
  if (isCloud() && permissions.manageBilling && !license) {
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

  // Notices for accounts using a license key
  if (license) {
    if (license?.usingMongoCache) {
      // Cache is good for a week
      const cachedDataGoodUntil = new Date(
        new Date(license.dateUpdated).getTime() + 7 * 24 * 60 * 60 * 1000
      );
      const daysLeftInCache = daysLeft(cachedDataGoodUntil.toDateString());
      if (daysLeftInCache < 5) {
        return (
          <Tooltip
            body={<>Please make sure that you have whitelisted 75.2.109.47</>}
          >
            <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
              <FaExclamationTriangle /> Could not contact license server. Fix
              within {daysLeftInCache} days.
            </div>
          </Tooltip>
        );
      }
    }

    // Trial license is up
    const licenseTrialRemaining = license.isTrial
      ? daysLeft(license.dateExpires)
      : -1;
    if (license?.organizationId && license.organizationId !== organization.id) {
      return (
        <Tooltip
          body={
            <>
              Your license key appears to be invalid. Please contact
              sales@growthbook.io for assistance.
            </>
          }
        >
          <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
            <FaExclamationTriangle /> Invalid license
          </div>
        </Tooltip>
      );
    }

    if (license.emailVerified === false && license.plan) {
      return (
        <Tooltip
          body={
            <>
              An email was sent to {license.email}. If you can&apos;t find it,
              check your spam folder, or restart the upgrade process.
            </>
          }
        >
          <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
            Check email to verify account and activate {license.plan}{" "}
            {license.isTrial ? "trial" : "license"}.
          </div>
        </Tooltip>
      );
    }

    if (licenseTrialRemaining >= 0) {
      if (license.plan === "enterprise") {
        return (
          <Tooltip
            body={
              <>
                Contact sales@growthbook.io if you need more time or would like
                to upgrade
              </>
            }
          >
            <div className="alert alert-warning py-1 px-2 mb-0 d-none d-md-block mr-1">
              <span className="badge badge-warning">
                {licenseTrialRemaining}
              </span>{" "}
              day
              {licenseTrialRemaining === 1 ? "" : "s"} left in trial
            </div>
          </Tooltip>
        );
      } else {
        return (
          <button
            className="alert alert-warning py-1 px-2 mb-0 d-none d-md-block mr-1"
            onClick={(e) => {
              e.preventDefault();
              router.push("/settings/billing");
            }}
          >
            <div className="badge badge-warning">{licenseTrialRemaining}</div>{" "}
            day
            {licenseTrialRemaining === 1 ? "" : "s"} left in trial
          </button>
        );
      }
    }

    // License expired
    if (license.dateExpires < new Date().toISOString().substring(0, 10)) {
      return (
        <Tooltip
          body={
            license.plan === "enterprise" ? (
              <>
                Your license expired on{" "}
                <strong>{date(license.dateExpires)}</strong>. Contact
                sales@growthbook.io to renew.
              </>
            ) : (
              <>
                Your license expired on{" "}
                <strong>{date(license.dateExpires)}</strong>. Go to your
                settings &gt; billing page to renew.
              </>
            )
          }
        >
          <div className="alert alert-danger py-1 px-2 d-none d-md-block mb-0 mr-1">
            <FaExclamationTriangle /> license expired
          </div>
        </Tooltip>
      );
    }

    // More seats than the license allows for
    if (
      license.plan === "enterprise" &&
      activeAndInvitedUsers > license.seats
    ) {
      return (
        <Tooltip
          body={
            <>
              Your license is valid for <strong>{license.seats} seats</strong>,
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
