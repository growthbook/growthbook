import { date, daysLeft } from "shared/dates";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import track from "@/services/track";
import { AppNotice } from "./notices";

export default function useAccountPlanNotices(): AppNotice[] {
  const permissionsUtil = usePermissionsUtil();
  const { usage, license, licenseError, seatsInUse } = useUser();
  const canManageBilling = permissionsUtil.canManageBilling();
  const canViewUsage = permissionsUtil.canViewUsage();

  const usageDetails = (
    docsHref: string,
    trackEvent: string,
    docsLabel = "FAQ",
  ) =>
    canViewUsage ? (
      <>
        Click to upgrade, or go to{" "}
        <Link href="/settings/usage">Settings &gt; Usage</Link> to learn more
      </>
    ) : (
      <>
        Click to upgrade, or visit{" "}
        <Link href={docsHref} external onClick={() => track(trackEvent)}>
          GrowthBook Docs &gt; {docsLabel}
        </Link>
      </>
    );

  const notices: AppNotice[] = [];

  const cdn = usage?.cdn.status;
  if (cdn === "approaching" || cdn === "over") {
    notices.push({
      id: "cdn-usage",
      severity: cdn === "over" ? "error" : "warning",
      title:
        cdn === "over"
          ? "CDN usage limit exceeded"
          : "Approaching CDN usage limit",
      details: usageDetails(
        "https://docs.growthbook.io/faq#what-are-the-growthbook-cloud-cdn-usage-limits",
        "Clicked Read About CDN Limits Link in Tooltip",
      ),
      upgrade: {
        source:
          cdn === "over"
            ? "usage-exceeded-topnav-notification"
            : "usage-approaching-topnav-notification",
        commercialFeature: "unlimited-cdn-usage",
      },
    });
  }

  const warehouse = usage?.managedClickhouse?.status;
  if (warehouse === "approaching" || warehouse === "over") {
    notices.push({
      id: "managed-warehouse-usage",
      severity: warehouse === "over" ? "error" : "warning",
      title:
        warehouse === "over"
          ? "Managed Warehouse event limit exceeded"
          : "Approaching Managed Warehouse event limit",
      details: usageDetails(
        "https://docs.growthbook.io/app/managed-warehouse#limits",
        "Clicked Read About Managed Warehouse Limits Link in Tooltip",
      ),
      upgrade: {
        source:
          warehouse === "over"
            ? "managed-warehouse-usage-exceeded-topnav-notification"
            : "managed-warehouse-usage-approaching-topnav-notification",
        commercialFeature: "unlimited-managed-warehouse-usage",
      },
    });
  }

  const forwarder = usage?.eventForwarder?.status;
  if (forwarder === "approaching" || forwarder === "over") {
    notices.push({
      id: "event-forwarder-usage",
      severity: forwarder === "over" ? "error" : "warning",
      title:
        forwarder === "over"
          ? "Event Forwarder event limit exceeded"
          : "Approaching Event Forwarder event limit",
      details: (
        <>
          {forwarder === "over"
            ? "Forwarding has stopped for the rest of the month. Events received while it is stopped are not delivered."
            : "Forwarding stops for the rest of the month once the limit is exceeded."}{" "}
          {usageDetails(
            "https://docs.growthbook.io/app/event-forwarder#usage-limits",
            "Clicked Read About Event Forwarder Limits Link in Tooltip",
            "Event Forwarder",
          )}
        </>
      ),
      upgrade: {
        source:
          forwarder === "over"
            ? "event-forwarder-usage-exceeded-topnav-notification"
            : "event-forwarder-usage-approaching-topnav-notification",
        commercialFeature: "unlimited-event-forwarder-usage",
      },
    });
  }

  const licenseNotice = ((): AppNotice | null => {
    if (
      license?.message &&
      (license.message.showAllUsers || canManageBilling)
    ) {
      return {
        id: "license",
        severity: "error",
        title: license.message.text,
        details: license.message.tooltipText,
      };
    }
    if (!license) return null;

    // Notices that result in a downgrade to Starter
    if (licenseError) {
      const error = (title: string, details: AppNotice["details"]) => ({
        id: "license",
        severity: "error" as const,
        title,
        details,
      });
      switch (licenseError) {
        case "Invalid license key signature":
          return error(
            "invalid license key signature",
            "There is something wrong with your license. Please contact support@growthbook.io.",
          );
        case "License server unreachable for too long":
          return error(
            "license server unreachable",
            "Please make sure that you have whitelisted 75.2.109.47",
          );
        case "License server erroring for too long":
          return error("license server error", license.lastServerErrorMessage);
        case "No support for SSO":
          return error(
            "invalid sso configuration",
            "Your license doesn't support SSO. Upgrade to Enterprise or remove SSO_CONFIG env variable.",
          );
        case "No support for multi-org":
          return error(
            "invalid multi-org configuration",
            "Your license doesn't support multi-org. Upgrade to Enterprise or remove IS_MULTI_ORG env variable.",
          );
        case "License expired": {
          // Not shown once it expired more than 30 days ago
          if (daysLeft(license.dateExpires || "") < -30) return null;
          const enterprise = license.plan === "enterprise";
          return {
            ...error(
              `${enterprise ? "Enterprise" : "Pro"} license expired ${date(license.dateExpires || "")}`,
              enterprise ? (
                "Contact sales@growthbook.io to renew."
              ) : (
                <>
                  Click to upgrade, or go to{" "}
                  <Link href="/settings/billing">Settings &gt; Billing</Link> to
                  learn more.
                </>
              ),
            ),
            ...(!enterprise && {
              upgrade: {
                source: "topnav-expired-notification",
                commercialFeature: null,
              },
            }),
          };
        }
        case "Email not verified":
          return error(
            `Check email to verify account and activate ${license.plan} ${license.isTrial ? "trial" : "license"}.`,
            `An email was sent to ${license.email}. If you can't find it, check your spam folder, or restart the upgrade process.`,
          );
        case "Invalid license":
          return error(
            "invalid license",
            "Your license key appears to be invalid. Please contact sales@growthbook.io for assistance.",
          );
        case "License invalidated":
          return error(
            "license invalidated",
            "Your license has been invalidated. Please contact sales@growthbook.io to resolve this issue.",
          );
        default:
          return error(
            licenseError.toLowerCase(),
            "Please contact support@growthbook.io for assistance.",
          );
      }
    }

    // Warnings that don't result in a downgrade
    if (
      license.usingMongoCache &&
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
          return {
            id: "license",
            severity: "error",
            // Keys that never reached the license server have no plan to lose
            title: `Could not connect to license server${
              license.plan
                ? `. Fix within ${daysLeftInCache} day${daysLeftInCache !== 1 ? "s" : ""}.`
                : ""
            }`,
            details: "Please make sure that you have whitelisted 75.2.109.47",
          };
        }
        return {
          id: "license",
          severity: "error",
          title: "License server error",
          details: license.lastServerErrorMessage,
        };
      }
    }

    if (license.isTrial) {
      const remaining = daysLeft(license.dateExpires || "");
      if (remaining >= 0) {
        return {
          id: "license",
          severity: "warning",
          title: `${remaining} day${remaining === 1 ? "" : "s"} left in trial`,
          ...(license.plan === "enterprise"
            ? {
                details:
                  "Contact sales@growthbook.io if you need more time or would like to upgrade",
              }
            : { href: "/settings/billing" }),
        };
      }
    }

    // Orb-managed licenses bill for seats in use, so the manual seat allotment
    // never applies, including once the subscription has ended.
    if (
      license.plan === "enterprise" &&
      !license.orbSubscription?.id &&
      seatsInUse > (license.seats || 0) &&
      canManageBilling
    ) {
      return {
        id: "license",
        severity: "error",
        title: "License seat quota exceeded",
        details: (
          <>
            Your license is valid for <strong>{license.seats} seats</strong>,
            but you are currently using <strong>{seatsInUse}</strong>. Contact
            sales@growthbook.io to extend your quota.
          </>
        ),
      };
    }
    return null;
  })();

  // The license notice outranks a usage limit of the same severity
  if (licenseNotice) notices.push({ ...licenseNotice, priority: 1 });
  return notices;
}
