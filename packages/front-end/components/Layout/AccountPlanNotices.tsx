import { useRouter } from "next/router";
import { FaExclamationTriangle } from "react-icons/fa";
import { date, daysLeft } from "shared/dates";
import { useState } from "react";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import track from "@/services/track";
import styles from "./AccountPlanNotices.module.scss";

export default function AccountPlanNotices() {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { usage, license, licenseError, seatsInUse } = useUser();
  const [upgradeModal, setUpgradeModal] = useState(false);

  const canManageBilling = permissionsUtil.canManageBilling();

  const usageTooltipBody = permissionsUtil.canViewUsage() ? (
    <Box className={styles["notice-tooltip"]}>
      Click to upgrade, or go to{" "}
      <Link href="/settings/usage">Settings &gt; Usage</Link> to learn more
    </Box>
  ) : (
    <Box className={styles["notice-tooltip"]}>
      Click to upgrade, or visit{" "}
      <a
        href="https://docs.growthbook.io/faq#what-are-the-growthbook-cloud-cdn-usage-limits"
        className="text-decoration-none"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          track("Clicked Read About CDN Limits Link in Tooltip");
        }}
      >
        Growthbook Docs &gt; FAQ
      </a>
    </Box>
  );

  let cdnUsageMessage: React.ReactNode | null = null;
  if (usage?.cdn.status === "approaching") {
    cdnUsageMessage = (
      <>
        {upgradeModal && (
          <div>
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              source={"usage-approaching-topnav-notification"}
              commercialFeature="unlimited-cdn-usage"
            />
          </div>
        )}
        <Tooltip body={usageTooltipBody}>
          <Box className={styles["warning-notification"]}>
            Approaching CDN usage limit.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade license.
            </a>{" "}
          </Box>
        </Tooltip>
      </>
    );
  } else if (usage?.cdn.status === "over") {
    cdnUsageMessage = (
      <>
        {upgradeModal && (
          <div>
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              source={"usage-exceeded-topnav-notification"}
              commercialFeature="unlimited-cdn-usage"
            />
          </div>
        )}
        <Tooltip body={usageTooltipBody}>
          <Box className={styles["error-notification"]}>
            CDN usage limit exceeded.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade license.
            </a>{" "}
          </Box>
        </Tooltip>
      </>
    );
  }

  const managedWarehouseUsageTooltipBody = permissionsUtil.canViewUsage() ? (
    <Box className={styles["notice-tooltip"]}>
      Click to upgrade, or go to{" "}
      <Link href="/settings/usage">Settings &gt; Usage</Link> to learn more
    </Box>
  ) : (
    <Box className={styles["notice-tooltip"]}>
      Click to upgrade, or visit{" "}
      <a
        href="https://docs.growthbook.io/app/managed-warehouse#limits"
        className="text-decoration-none"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          track("Clicked Read About Managed Warehouse Limits Link in Tooltip");
        }}
      >
        Growthbook Docs &gt; FAQ
      </a>
    </Box>
  );

  let managedWarehouseUsageMessage: React.ReactNode | null = null;
  if (usage?.managedClickhouse?.status === "approaching") {
    managedWarehouseUsageMessage = (
      <>
        {upgradeModal && (
          <div>
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              source={"managed-warehouse-usage-approaching-topnav-notification"}
              commercialFeature="unlimited-managed-warehouse-usage"
            />
          </div>
        )}
        <Tooltip body={managedWarehouseUsageTooltipBody}>
          <Box className={styles["warning-notification"]}>
            Approaching Managed Warehouse event limit.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade license.
            </a>{" "}
          </Box>
        </Tooltip>
      </>
    );
  } else if (usage?.managedClickhouse?.status === "over") {
    managedWarehouseUsageMessage = (
      <>
        {upgradeModal && (
          <div>
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              source={"managed-warehouse-usage-exceeded-topnav-notification"}
              commercialFeature="unlimited-managed-warehouse-usage"
            />
          </div>
        )}
        <Tooltip body={managedWarehouseUsageTooltipBody}>
          <Box className={styles["error-notification"]}>
            Managed Warehouse event limit exceeded.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade license.
            </a>{" "}
          </Box>
        </Tooltip>
      </>
    );
  }

  const usageMessage = cdnUsageMessage || managedWarehouseUsageMessage;
  if (license?.message && (license.message.showAllUsers || canManageBilling)) {
    return (
      <>
        {usageMessage}
        <Tooltip body={<>{license.message.tooltipText}</>}>
          <Box className={styles["error-notification"]}>
            <FaExclamationTriangle /> {license.message.text}
          </Box>
        </Tooltip>
      </>
    );
  }

  // Notices for accounts using a license key that result in a downgrade to starter
  if (license) {
    if (licenseError) {
      switch (licenseError) {
        case "Invalid license key signature":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>
                    There is something wrong with your license. Please contact
                    support@growthbook.io.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> invalid license key signature
                </Box>
              </Tooltip>
            </Flex>
          );
        case "License server unreachable for too long":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>Please make sure that you have whitelisted 75.2.109.47</>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> license server unreachable
                </Box>
              </Tooltip>
            </Flex>
          );
        case "License server erroring for too long":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip body={<>{license.lastServerErrorMessage}</>}>
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> license server error
                </Box>
              </Tooltip>
            </Flex>
          );
        case "No support for SSO":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>
                    Your license doesn&apos;t support SSO. Upgrade to Enterprise
                    or remove SSO_CONFIG env variable.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> invalid sso configuration
                </Box>
              </Tooltip>
            </Flex>
          );
        case "No support for multi-org":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>
                    Your license doesn&apos;t support multi-org. Upgrade to
                    Enterprise or remove IS_MULTI_ORG env variable.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> invalid multi-org configuration
                </Box>
              </Tooltip>
            </Flex>
          );
        case "License expired":
          // if the license expired more than 30 days ago, we don't show the notice
          if (daysLeft(license.dateExpires || "") < -30) {
            return usageMessage;
          } else {
            const badgeTextDiv = (
              <>
                {license.plan === "enterprise" ? "Enterprise" : "Pro"} license
                expired <u>{date(license.dateExpires || "")}</u>
              </>
            );

            if (usage?.cdn.status === "approaching") {
              return (
                <>
                  <div>
                    {upgradeModal && (
                      <UpgradeModal
                        close={() => setUpgradeModal(false)}
                        source={"topnav-expired-notification"}
                        commercialFeature={null}
                      />
                    )}
                  </div>
                  <Tooltip
                    body={
                      license.plan === "enterprise" ? (
                        <>Contact sales@growthbook.io to renew.</>
                      ) : (
                        <Box className={styles["notice-tooltip"]}>
                          Pro license expired {date(license.dateExpires || "")}.
                          Click to upgrade, or go to{" "}
                          <Link href="/settings/usage">
                            Settings &gt; Usage
                          </Link>{" "}
                          to learn more.
                        </Box>
                      )
                    }
                  >
                    <Box className={styles["warning-notification"]}>
                      Approaching CDN usage limit.{" "}
                      <a href="#" onClick={() => setUpgradeModal(true)}>
                        Upgrade License
                      </a>
                    </Box>
                  </Tooltip>
                </>
              );
            } else if (usage?.cdn.status === "over") {
              return (
                <>
                  <div>
                    {upgradeModal && (
                      <UpgradeModal
                        close={() => setUpgradeModal(false)}
                        source={"topnav-expired-notification"}
                        commercialFeature={null}
                      />
                    )}
                  </div>
                  <Tooltip
                    body={
                      license.plan === "enterprise" ? (
                        <>Contact sales@growthbook.io to renew.</>
                      ) : (
                        <Box className={styles["notice-tooltip"]}>
                          Pro license expired {date(license.dateExpires || "")}.
                          Click to upgrade, or go to{" "}
                          <Link href="/settings/usage">
                            Settings &gt; Usage
                          </Link>{" "}
                          to learn more.
                        </Box>
                      )
                    }
                  >
                    <Box className={styles["error-notification"]}>
                      CDN usage limit exceeded.{" "}
                      <a href="#" onClick={() => setUpgradeModal(true)}>
                        Upgrade License
                      </a>
                    </Box>
                  </Tooltip>
                </>
              );
            } else {
              return (
                <>
                  <div>
                    {upgradeModal && (
                      <UpgradeModal
                        close={() => setUpgradeModal(false)}
                        source={"topnav-expired-notification"}
                        commercialFeature={null}
                      />
                    )}
                  </div>
                  <Tooltip
                    body={
                      license.plan === "enterprise" ? (
                        <>Contact sales@growthbook.io to renew.</>
                      ) : (
                        <>
                          Click to upgrade, or go to{" "}
                          <Link href="/settings/billing">
                            Settings &gt; Billing
                          </Link>{" "}
                          to learn more.
                        </>
                      )
                    }
                  >
                    <Box className={styles["error-notification"]}>
                      {license.plan === "enterprise" ? (
                        badgeTextDiv
                      ) : (
                        <a
                          href="#"
                          onClick={() => setUpgradeModal(true)}
                          style={{ textDecoration: "none" }}
                        >
                          {badgeTextDiv}
                        </a>
                      )}
                    </Box>
                  </Tooltip>
                </>
              );
            }
          }
        case "Email not verified":
          return (
            <>
              {usageMessage}
              <Tooltip
                body={
                  <>
                    An email was sent to {license.email}. If you can&apos;t find
                    it, check your spam folder, or restart the upgrade process.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  Check email to verify account and activate {license.plan}{" "}
                  {license.isTrial ? "trial" : "license"}.
                </Box>
              </Tooltip>
            </>
          );
        case "Invalid license":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>
                    Your license key appears to be invalid. Please contact
                    sales@growthbook.io for assistance.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> invalid license
                </Box>
              </Tooltip>
            </Flex>
          );
        case "License invalidated":
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={
                  <>
                    Your license has been invalidated. Please contact
                    sales@growthbook.io to resolve this issue.
                  </>
                }
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> license invalidated
                </Box>
              </Tooltip>
            </Flex>
          );
        default:
          return (
            <Flex gap={"3"} align="center">
              {usageMessage}
              <Tooltip
                body={<>Please contact support@growthbook.io for assistance.</>}
              >
                <Box className={styles["error-notification"]}>
                  <FaExclamationTriangle /> {licenseError.toLowerCase()}
                </Box>
              </Tooltip>
            </Flex>
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
          7 * 24 * 60 * 60 * 1000,
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
              <Box className={styles["error-notification"]}>
                <FaExclamationTriangle /> Could not connect to license server
                {/*license keys specified in env vars that have never connected to the license server successfully won't have any plan and hence aren't in danger of being downgraded */}
                {license.plan
                  ? `. Fix within ${daysLeftInCache} day${
                      daysLeftInCache != 1 ? "s" : ""
                    }.`
                  : ""}
              </Box>
            </Tooltip>
          );
        } else {
          return (
            <Tooltip body={<>{license.lastServerErrorMessage}</>}>
              <Box className={styles["error-notification"]}>
                <FaExclamationTriangle /> License server error
              </Box>
            </Tooltip>
          );
        }
      }
    }
    // Trial license is almost up
    if (license.isTrial) {
      const licenseTrialRemaining = daysLeft(license.dateExpires || "");
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
              <Box className={styles["warning-notification"]}>
                <span className="badge badge-warning">
                  {licenseTrialRemaining}
                </span>{" "}
                day
                {licenseTrialRemaining === 1 ? "" : "s"} left in trial
              </Box>
            </Tooltip>
          );
        } else {
          return (
            <button
              className={styles["warning-notification"]}
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

    const isEnterpriseLicense = license.plan === "enterprise";
    const seatsExceedLicense = seatsInUse > (license.seats || 0);
    if (isEnterpriseLicense && seatsExceedLicense && canManageBilling) {
      return (
        <Tooltip
          body={
            <>
              Your license is valid for <strong>{license.seats} seats</strong>,
              but you are currently using <strong>{seatsInUse}</strong>. Contact
              sales@growthbook.io to extend your quota.
            </>
          }
        >
          <Box className={styles["error-notification"]}>
            License seat quota exceeded
          </Box>
        </Tooltip>
      );
    }
  }

  return usageMessage;
}
