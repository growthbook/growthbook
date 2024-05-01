import { useRouter } from "next/router";
import { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { date, daysLeft } from "shared/dates";
import usePermissions from "@/hooks/usePermissions";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function AccountPlanNotices() {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const permissions = usePermissions();
  const router = useRouter();
  const { license, licenseError } = useUser();
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

  // Notices for accounts using a license key that result in a downgrade to starter
  if (license) {
    if (licenseError) {
      switch (licenseError) {
        case "Invalid license key signature":
          return (
            <Tooltip
              body={
                <>
                  There is something wrong with your license. Please contact
                  support@growthbook.io.
                </>
              }
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> invalid license key signature
              </div>
            </Tooltip>
          );
        case "License server unreachable for too long":
          return (
            <Tooltip
              body={<>Please make sure that you have whitelisted 75.2.109.47</>}
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> license server unreachable
              </div>
            </Tooltip>
          );
        case "License server erroring for too long":
          return (
            <Tooltip body={<>{license.lastServerErrorMessage}</>}>
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> license server error
              </div>
            </Tooltip>
          );
        case "No support for SSO":
          return (
            <Tooltip
              body={
                <>
                  Your license doesn&apos;t support SSO. Upgrade to Enterprise
                  or remove SSO_CONFIG env variable.
                </>
              }
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> invalid sso configuration
              </div>
            </Tooltip>
          );
        case "No support for multi-org":
          return (
            <Tooltip
              body={
                <>
                  Your license doesn&apos;t support multi-org. Upgrade to
                  Enterprise or remove IS_MULTI_ORG env variable.
                </>
              }
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> invalid multi-org configuration
              </div>
            </Tooltip>
          );
        case "License expired":
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
        case "Email not verified":
          return (
            <Tooltip
              body={
                <>
                  An email was sent to {license.email}. If you can&apos;t find
                  it, check your spam folder, or restart the upgrade process.
                </>
              }
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                Check email to verify account and activate {license.plan}{" "}
                {license.isTrial ? "trial" : "license"}.
              </div>
            </Tooltip>
          );
        case "Invalid license":
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
                <FaExclamationTriangle /> invalid license
              </div>
            </Tooltip>
          );
        case "License invalidated":
          return (
            <Tooltip
              body={
                <>
                  Your license has been invalidated. Please contact
                  sales@growthbook.io to resolve this issue.
                </>
              }
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> license invalidated
              </div>
            </Tooltip>
          );
        default:
          return (
            <Tooltip
              body={<>Please contact support@growthbook.io for assistance.</>}
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> {licenseError.toLowerCase()}
              </div>
            </Tooltip>
          );
      }
    }

    //Warnings that don't result in a downgrade

    if (
      license?.usingMongoCache &&
      license.firstFailedFetchDate &&
      license.lastFailedFetchDate
    ) {
      // Cache is good for a week from the first failed fetch date
      const cachedDataGoodUntil = new Date(
        new Date(license.firstFailedFetchDate).getTime() +
          7 * 24 * 60 * 60 * 1000
      );

      const daysLeftInCache = daysLeft(cachedDataGoodUntil.toDateString());
      const daysDown =
        daysLeft(new Date(license.lastFailedFetchDate).toDateString()) -
        daysLeft(new Date(license.firstFailedFetchDate).toDateString());

      if (daysDown > 1 && license.lastServerErrorMessage) {
        if (license.lastServerErrorMessage.startsWith("Could not connect")) {
          return (
            <Tooltip
              body={<>Please make sure that you have whitelisted 75.2.109.47</>}
            >
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> Could not connect to license server
                {/*license keys specified in env vars that have never connected to the license server successfully won't have any plan and hence aren't in danger of being downgraded */}
                {license.plan
                  ? `. Fix within ${daysLeftInCache} day${
                      daysLeftInCache != 1 ? "s" : ""
                    }.`
                  : ""}
              </div>
            </Tooltip>
          );
        } else {
          return (
            <Tooltip body={<>{license.lastServerErrorMessage}</>}>
              <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
                <FaExclamationTriangle /> License server error
              </div>
            </Tooltip>
          );
        }
      }
    }
    // Trial license is almost up
    if (license.isTrial) {
      const licenseTrialRemaining = daysLeft(license.dateExpires);
      if (licenseTrialRemaining >= 0) {
        if (license.plan === "enterprise") {
          return (
            <Tooltip
              body={
                <>
                  Contact sales@growthbook.io if you need more time or would
                  like to upgrade
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
            <FaExclamationTriangle /> license quota exceeded
          </div>
        </Tooltip>
      );
    }
  }

  return null;
}
