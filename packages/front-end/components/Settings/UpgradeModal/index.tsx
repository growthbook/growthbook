import { useEffect, useState } from "react";
import clsx from "clsx";
import { date, daysLeft } from "shared/dates";
import Link from "next/link";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FaCheckCircle } from "react-icons/fa";
import { PiCaretRight, PiArrowSquareOut } from "react-icons/pi";
import { CommercialFeature } from "shared/enterprise";
import { growthbook } from "@/services/utils";
import { useUser } from "@/services/UserContext";
import { getGrowthBookBuild, isCloud } from "@/services/env";
import track from "@/services/track";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioCards from "@/components/Radix/RadioCards";
import CloudProUpgradeModal from "@/enterprise/components/Billing/CloudProUpgradeModal";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import Callout from "@/components/Radix/Callout";
import styles from "./index.module.scss";
import CloudTrialConfirmationModal from "./CloudTrialConfirmationModal";
import LicenseSuccessModal from "./LicenseSuccessModal";
import PleaseVerifyEmailModal from "./PleaseVerifyEmailModal";
import SelfHostedTrialConfirmationModal from "./SelfHostedTrialConfirmationModal";

export interface Props {
  close: () => void;
  source: string;
  commercialFeature: CommercialFeature | null;
}

export default function UpgradeModal({
  close,
  source,
  commercialFeature,
}: Props) {
  const [error, setError] = useState("");
  const { apiCall } = useAuth();

  const [loading, setLoading] = useState(false);
  const [
    trialAndUpgradePreference,
    setTrialAndUpgradePreference,
  ] = useState<string>("trial");
  const [showSHProTrial, setShowSHProTrial] = useState(false);
  const [showSHProTrialSuccess, setShowSHProTrialSuccess] = useState(false);
  const [showSHEnterpriseTrial, setShowSHEnterpriseTrial] = useState(false);
  const [
    showSHEnterpriseTrialSuccess,
    setShowSHEnterpriseTrialSuccess,
  ] = useState(false);

  const [showCloudEnterpriseTrial, setShowCloudEnterpriseTrial] = useState(
    false
  );
  const [
    showCloudEnterpriseTrialSuccess,
    setShowCloudEnterpriseTrialSuccess,
  ] = useState(false);
  const [cloudProUpgradeSetup, setCloudProUpgradeSetup] = useState<{
    clientSecret: string;
  } | null>(null);
  const [showCloudProTrial, setShowCloudProTrial] = useState(false);
  const [showCloudProTrialSuccess, setShowCloudProTrialSuccess] = useState(
    false
  );
  const {
    name,
    email,
    accountPlan,
    license,
    effectiveAccountPlan,
    commercialFeatureLowestPlan,
    subscription,
    users,
  } = useUser();
  const numOfCurrentMembers = users.size || 1;
  const permissionsUtil = usePermissionsUtil();

  const { organization, refreshOrganization } = useUser();

  const currentUsers =
    (organization.members?.length || 0) + (organization.invites?.length || 0);

  const licensePlanText =
    (accountPlan === "enterprise"
      ? "Enterprise"
      : accountPlan === "pro"
      ? "Pro"
      : accountPlan === "pro_sso"
      ? "Pro + SSO"
      : "Starter") + (license && license.isTrial ? " trial" : "");

  // When signing up to pro, but not finishing the checkout process a license gets generated and saved but has no plan.
  const freeTrialAvailable =
    !license || !license.plan || !license.emailVerified;

  // These are some Upgrade CTAs throughout the app related to enterprise-only features
  // we don't want to show a user the test treatments if that's the case
  // since this test doesn't highlight enterprise features at all.
  const lowestPlan = commercialFeature
    ? commercialFeatureLowestPlan?.[commercialFeature]
    : "starter";
  const featureFlagValue =
    isCloud() && lowestPlan !== "enterprise" && license?.plan !== "enterprise"
      ? growthbook.getFeatureValue("pro-upgrade-modal", "OFF")
      : "OFF";
  const daysToGo = license?.dateExpires ? daysLeft(license.dateExpires) : 0;

  const hasCanceledSubscription =
    ["pro", "pro_sso"].includes(license?.plan || "") &&
    subscription?.status === "canceled";

  const trackContext = {
    accountPlan,
    source,
    currentUsers,
    freeTrialAvailable,
  };

  const useInlineUpgradeForm =
    isCloud() && growthbook.getFeatureValue("ff_embedded-payment-form", false);

  useEffect(() => {
    track("View Upgrade Modal", trackContext);
    // Even if accountPlan gets update during this upgrade process, we don't want to call this track call multiple times
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      ["enterprise"].includes(effectiveAccountPlan || "") &&
      !license?.isTrial
    ) {
      close();
    }
  }, [effectiveAccountPlan, license, close]);

  const isAtLeastPro = ["pro", "pro_sso", "enterprise"].includes(
    effectiveAccountPlan || ""
  );
  const proTrialCopy = "free 14-day Pro trial";

  const startPro = async () => {
    setError("");
    setLoading(true);
    try {
      if (subscription && subscription.status != "canceled") {
        const res = await apiCall<{ url: string }>(`/subscription/manage`, {
          method: "POST",
        });
        if (res && res.url) {
          track(
            "Start Stripe Checkout For Pro With Existing Subscription",
            trackContext
          );
          await redirectWithTimeout(res.url);
        } else {
          setError("Unknown response");
        }
      } else if (useInlineUpgradeForm) {
        // Sets up in-app upgrade
        const { clientSecret } = await apiCall<{
          clientSecret: string;
        }>(`/subscription/setup-intent`, {
          method: "POST",
        });
        setCloudProUpgradeSetup({ clientSecret });
        setLoading(false);
      } else {
        // Otherwise, this creates a new checkout session and will redirect to the Stripe checkout page
        const resp = await apiCall<{
          status: number;
          session?: { url?: string };
        }>(`/subscription/new`, {
          method: "POST",
          body: JSON.stringify({
            returnUrl: window.location.pathname,
          }),
        });

        setLoading(false);
        if (resp.session?.url) {
          track(
            "Start Stripe Checkout For Pro Without Existing Subscription",
            trackContext
          );
          await redirectWithTimeout(resp.session.url);
        } else {
          setError("Failed to start checkout");
        }
      }
    } catch (e) {
      setLoading(false);
      setError(e.message);
    }
  };

  function startEnterprise() {
    track("Start Enterprise Checkout", trackContext);
    const subject = organization.name
      ? "Inquiry about Enterprise Plan for " + organization.name
      : "Inquiry about Enterprise Plan";
    const mailtoLink = `mailto:sales@growthbook.io?subject=${encodeURIComponent(
      subject
    )}`;
    const newWindow = window.open(mailtoLink, "_blank", "noreferrer");
    if (newWindow) newWindow.opener = null;
  }

  const startProTrial = async function (name?: string, email?: string) {
    setError("");
    try {
      await apiCall<{
        status: number;
        session?: { url?: string };
      }>(`/subscription/new-pro-trial`, {
        method: "POST",
        body: JSON.stringify({
          name: name,
          email: email,
        }),
      });
      track("Generate pro trial license", trackContext);

      if (isCloud()) {
        setShowCloudProTrialSuccess(true);
        setShowCloudProTrial(false);
      } else {
        setShowSHProTrialSuccess(true);
        setShowSHProTrial(false);
      }

      refreshOrganization();
    } catch (e) {
      const txt = e.message;
      track("Generate enterprise pro license error", {
        error: txt,
        ...trackContext,
      });
      setError(
        `There was a server error: ${txt}. Please try again later, or contact us at sales@growthbook.io`
      );
    }
  };

  const startEnterpriseTrial = async function (name?: string, email?: string) {
    setError("");
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>(`/license/enterprise-trial`, {
        method: "POST",
        body: JSON.stringify({
          email: email,
          name: name,
          organizationId: organization.id,
          companyName: organization.name,
          context: {
            organizationCreated: organization.dateCreated,
            currentSeats: currentUsers,
            currentPlan: accountPlan,
            currentBuild: getGrowthBookBuild(),
            ctaSource: source,
          },
        }),
      });
      track("Generate enterprise trial license", trackContext);

      await refreshOrganization();
      if (isCloud()) {
        setShowCloudEnterpriseTrialSuccess(true);
        setShowCloudEnterpriseTrial(false);
      } else {
        setShowSHEnterpriseTrialSuccess(true);
        setShowSHEnterpriseTrial(false);
      }
    } catch (e) {
      const txt = e.message;
      track("Generate enterprise trial license error", {
        error: txt,
        ...trackContext,
      });
      switch (txt) {
        case "active license exists":
          setError(
            "You already have an active license key. Contact us at sales@growthbook.io for more information."
          );
          break;
        case "expired license exists":
          setError(
            "Your license key has already expired. Please contact us at sales@growthbook.io for more information."
          );
          break;
        default:
          setError(
            `There was a server error: ${txt}. Please try again later, or contact us at sales@growthbook.io`
          );
      }
    }
  };

  const bullets: Partial<Record<CommercialFeature, string>> = {
    "advanced-permissions": "Manage advanced user permissions",
    "encrypt-features-endpoint": "SDK endpoint encryption",
    "schedule-feature-flag": "Schedule feature flag rollouts",
    "override-metrics": "Override metric definitions on a per-experiment basis",
    "regression-adjustment": "Increase experiment velocity with CUPED",
    "sequential-testing": "Sequential testing for always-valid p-values",
    "visual-editor":
      "Use our no-code Visual Editor to create front-end experiments",
    archetypes:
      "Save user archetypes and use them to debug feature flag values",
    simulate:
      "Simulate how different users would see an experiment or feature flag",
    "cloud-proxy":
      "Use a self-hosted GrowthBook proxy in front of our Cloud CDN",
    "hash-secure-attributes":
      "Hash sensitive targeting attributes like email addresses to avoid leaking PII",
    livechat: "Get fast support with in-app chat",
    "remote-evaluation": "Enable remote-evaluation for client-side SDKs",
    "sticky-bucketing": "Ensure consistent experiences with Sticky Bucketing",
    "code-references":
      "Quickly see where feature flags are referenced in your codebase",
    prerequisites:
      "Define dependencies between feature flags with Pre-requisites",
    redirects: "Run URL Redirect tests",
    "multiple-sdk-webhooks":
      "Implement custom caching and notification logic with SDK Webhooks",
    "quantile-metrics":
      "Define quantile metrics such as P99 latency or Median revenue",
    "retention-metrics":
      "Define retention metrics that measure return activity",
    "metric-populations": "Analyze metrics for different sub-populations",
    "multi-armed-bandits": "Run adaptive experiments with Bandits",
    "historical-power":
      "Power calculator that uses historical data for accurate predictions",
    "decision-framework":
      "Estimate experiment duration using your data & get shipping recommendations.",
  };

  const upgradeHeader = (
    <>
      <h3
        className="mb-1"
        style={{ color: "var(--color-text-high)", fontSize: "20px" }}
      >
        Upgrade to Pro
      </h3>
      <p
        className="mb-0"
        style={{ color: "var(--color-text-mid)", fontSize: "16px" }}
      >
        Get instant access to advanced experimentation, permissioning and
        security features.
      </p>
    </>
  );

  const enterpriseCallout = (
    <p className="mb-0" style={{ color: "var(--color-text-mid)" }}>
      Interested in an Enterprise Plan?
      <a
        href="https://www.growthbook.io/demo"
        className="text-decoration-none pl-1"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          track("Start Enterprise Checkout", trackContext);
        }}
      >
        <strong className="a link-purple text-decoration-none">
          Talk to Sales
        </strong>
      </a>
    </p>
  );

  function trialAndUpgradeTreatment() {
    return (
      <div>
        {upgradeHeader}
        <div className="py-4">
          <RadioCards
            columns="2"
            value={trialAndUpgradePreference}
            setValue={(v) => setTrialAndUpgradePreference(v)}
            options={[
              {
                value: "trial",
                label: "Pro Trial",
                description: "Free for 14 days - no credit card required.",
              },
              {
                value: "upgrade",
                label: "Pro",
                description: "Get started now",
              },
            ]}
          />
        </div>
        {enterpriseCallout}
      </div>
    );
  }

  function upgradeOnlyTreatment() {
    const dynamicBullet = commercialFeature ? bullets[commercialFeature] : null;
    const now = new Date();

    const licensePlanText =
      license?.plan === "enterprise" ? "Enterprise" : "Pro";
    const notice =
      license?.dateExpires && new Date(license?.dateExpires) < now
        ? `${licensePlanText} license expired ${date(
            license.dateExpires || ""
          )}. Renew to regain access to ${licensePlanText} features and higher usage limits.`
        : null;

    return (
      <div>
        {upgradeHeader}
        {notice && (
          <Box mt="4">
            <Callout status="error">{notice}</Callout>
          </Box>
        )}
        <div className="py-4">
          <Flex align="center" className="pb-2">
            <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
            <Text
              size={"3"}
              style={{ color: "var(--color-text-high)", fontWeight: 500 }}
            >
              {dynamicBullet || "Add up to 100 team members"}
            </Text>
          </Flex>
          <Flex align="center" className="pb-2">
            <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
            <Text
              size={"3"}
              style={{ color: "var(--color-text-high)", fontWeight: 500 }}
            >
              {dynamicBullet === "advanced-permissions"
                ? "Add up to 100 team members"
                : "Manage advanced user permissions"}
            </Text>
          </Flex>
          <Flex align="center" className="pb-2">
            <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
            <Text
              size={"3"}
              style={{ color: "var(--color-text-high)", fontWeight: 500 }}
            >
              Get access to advanced experimentation: CUPED, Sequential testing,
              Bandits and more
            </Text>
          </Flex>
        </div>
        {isCloud() && permissionsUtil.canManageBilling() && (
          <>
            <Box
              className="mb-4"
              style={{
                backgroundColor: "var(--violet-2)",
                padding: "20px 20px 24px 20px",
              }}
            >
              <Flex
                align="center"
                justify="between"
                style={{ color: "var(--color-text-high)" }}
                mb={"1"}
              >
                <Text size="3" weight={"bold"}>
                  Base price
                </Text>
                <Text size="3" weight={"bold"}>
                  ${numOfCurrentMembers * 20} / month
                </Text>
              </Flex>
              <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
                $20 per seat (Includes 2 million CDN requests and 20GB of
                bandwidth per month)
              </Text>

              <Text
                as="div"
                size="2"
                weight={"bold"}
                mt="3"
                style={{ color: "var(--color-text-high)" }}
              >
                Additional usage:
              </Text>
              <ul
                className="pl-4"
                style={{ color: "var(--color-text-mid)", fontWeight: 500 }}
              >
                <li> $10 per million CDN requests</li>
                <li> $1 per GB </li>
              </ul>

              <hr style={{ borderColor: "var(--slate-a6)" }} />
              <p className="mb-0">
                <a
                  href="/settings/usage"
                  className="text-decoration-none pl-1"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    track(
                      "Clicked See Recent Usage From Upgrade Modal",
                      trackContext
                    );
                  }}
                >
                  <Text size="1" weight="bold" className="a link-purple">
                    See your recent usage{" "}
                    <PiArrowSquareOut
                      style={{ position: "relative", top: "-2px" }}
                    />
                  </Text>
                </a>
              </p>
            </Box>
            <Callout status="info">
              Interested in an Enterprise Plan with volume discounts?
              <a
                href="https://www.growthbook.io/demo"
                className="text-decoration-none pl-1"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  track("Start Enterprise Checkout", trackContext);
                }}
              >
                <strong className="a link-purple">
                  Talk to Sales{" "}
                  <PiArrowSquareOut
                    style={{ position: "relative", top: "-2px" }}
                  />{" "}
                </strong>
              </a>
            </Callout>
          </>
        )}{" "}
        {!isCloud() && permissionsUtil.canManageBilling() && (
          <div>
            <div
              className="p-3 mb-4"
              style={{ backgroundColor: "var(--violet-2)" }}
            >
              <Flex align="center" justify="between">
                <span>
                  <label>Cost</label>
                  <Tooltip
                    color="purple"
                    body="Based on your current seat count."
                    className="pl-1"
                  />
                </span>
                <label>~${numOfCurrentMembers * 20} / month</label>
              </Flex>
              <p className="mb-0 text-secondary">
                $20 per seat per month, {numOfCurrentMembers} current seat
                {numOfCurrentMembers > 1 ? "s" : ""}
              </p>
            </div>
            {enterpriseCallout}
          </div>
        )}
      </div>
    );
  }

  async function onSubmit() {
    if (
      featureFlagValue === "UPGRADE-ONLY" ||
      trialAndUpgradePreference === "upgrade"
    ) {
      await startPro();
    } else {
      await startProTrial(name, email);
    }
  }

  return (
    <>
      {showSHProTrial ? (
        <SelfHostedTrialConfirmationModal
          close={close}
          plan="Pro"
          error={error}
          submit={startProTrial}
        />
      ) : showSHProTrialSuccess ? (
        <PleaseVerifyEmailModal
          close={close}
          plan="Pro"
          isTrial={true}
          reenterEmail={() => {
            setShowSHProTrial(true);
            setShowSHProTrialSuccess(false);
          }}
        />
      ) : showSHEnterpriseTrial ? (
        <SelfHostedTrialConfirmationModal
          close={close}
          plan="Enterprise"
          error={error}
          submit={startEnterpriseTrial}
        />
      ) : showSHEnterpriseTrialSuccess ? (
        <PleaseVerifyEmailModal
          close={close}
          plan="Enterprise"
          isTrial={true}
          reenterEmail={() => {
            setShowSHEnterpriseTrial(true);
            setShowSHEnterpriseTrialSuccess(false);
          }}
        />
      ) : showCloudProTrial ? (
        <CloudTrialConfirmationModal
          plan="Pro"
          close={close}
          error={error}
          submit={() => startProTrial(name, email)}
        />
      ) : showCloudProTrialSuccess ? (
        <LicenseSuccessModal
          plan="Pro"
          close={close}
          header={`🎉 Your 14-day Pro Trial starts now!`}
          isTrial={true}
        />
      ) : showCloudEnterpriseTrial ? (
        <CloudTrialConfirmationModal
          plan="Enterprise"
          close={close}
          error={error}
          submit={() => startEnterpriseTrial(name, email)}
        />
      ) : showCloudEnterpriseTrialSuccess ? (
        <LicenseSuccessModal
          plan="Enterprise"
          close={close}
          header={`🎉 Your 14-day Enterprise Trial starts now!`}
          isTrial={true}
        />
      ) : cloudProUpgradeSetup ? (
        <StripeProvider initialClientSecret={cloudProUpgradeSetup.clientSecret}>
          <CloudProUpgradeModal
            close={() => setCloudProUpgradeSetup(null)}
            closeParent={close}
          />
        </StripeProvider>
      ) : (
        <Modal
          trackingEventModalType="upgrade-modal"
          allowlistedTrackingEventProps={trackContext}
          open={true}
          autoCloseOnSubmit={false}
          includeCloseCta={featureFlagValue !== "OFF" ? true : false}
          close={close}
          size="lg"
          header={
            featureFlagValue === "OFF" ? <>Get more out of GrowthBook</> : null
          }
          showHeaderCloseButton={featureFlagValue === "OFF" ? true : false}
          loading={loading}
          cta={
            <>
              {featureFlagValue === "UPGRADE-ONLY" ||
              trialAndUpgradePreference === "upgrade"
                ? "Continue"
                : "Start Trial"}
              <PiCaretRight />
            </>
          }
          disabledMessage="Contact your admin to upgrade."
          ctaEnabled={permissionsUtil.canManageBilling()}
          submit={featureFlagValue !== "OFF" ? onSubmit : undefined}
        >
          <div
            className={clsx(
              "container-fluid dashboard p-3 ",
              styles.upgradeModal
            )}
          >
            {featureFlagValue === "OFF" ? (
              <>
                {!license?.isTrial &&
                  (daysToGo >= 0 && !hasCanceledSubscription ? (
                    <div className="row bg-main-color p-3 mb-3 rounded">
                      <span>You are currently using the </span>
                      <b className="mx-1"> {licensePlanText} </b> version of
                      Growthbook.
                    </div>
                  ) : daysToGo < 0 ? (
                    <div className="row p-3 mb-3 rounded alert-danger">
                      {" "}
                      <span>
                        Your old <b className="mx-1">{licensePlanText}</b>{" "}
                        version of Growthbook expired. Renew below.
                      </span>
                    </div>
                  ) : (
                    <div className="row p-3 mb-3 rounded alert-danger">
                      {" "}
                      <span>
                        Your old <b className="mx-1">{licensePlanText}</b>{" "}
                        version of Growthbook was cancelled. Renew below.
                      </span>
                    </div>
                  ))}
                {license?.isTrial && (
                  <div
                    className={`row p-3 mb-3 rounded ${
                      daysToGo <= 3
                        ? "alert-danger"
                        : daysToGo <= 7
                        ? "bg-muted-yellow"
                        : "bg-main-color"
                    }`}
                  >
                    {(daysToGo >= 0 && (
                      <div>
                        <span>
                          You have{" "}
                          <b>{daysLeft(license.dateExpires || "")} days</b> left
                          in your {licensePlanText} of Growthbook with{" "}
                        </span>
                        <Link
                          href="/settings/team"
                          className="mx-1 font-weight-bold"
                        >
                          {currentUsers} team members
                        </Link>
                        ↗
                      </div>
                    )) || (
                      <div>
                        <span>Your {licensePlanText} of Growthbook with </span>
                        <Link
                          href="/settings/team"
                          className="mx-1 font-weight-bold"
                        >
                          {currentUsers} team members
                        </Link>
                        ↗<span> has expired</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
            {featureFlagValue === "UPGRADE-ONLY" ? (
              upgradeOnlyTreatment()
            ) : featureFlagValue === "TRIAL-AND-UPGRADE" ? (
              trialAndUpgradeTreatment()
            ) : (
              <div className="row">
                <div
                  className={clsx(
                    "col-lg-6 mb-4",
                    isAtLeastPro && !license?.isTrial ? "disabled-opacity" : ""
                  )}
                >
                  <div className="pr-lg-2 border rounded p-0 d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-center p-2 px-3">
                      <h4 className="mb-0">Pro</h4>
                      <div className="text-right text-muted">
                        $20/user/month
                      </div>
                    </div>
                    <div className="border-top p-0 flex-grow-1">
                      <ul className="pt-4">
                        <li>
                          <b>Up to 100 team members</b>
                        </li>
                        <li>
                          <b>Advanced permissioning</b>
                        </li>
                        <li>
                          <b>Visual A/B test editor</b>
                        </li>
                        <li>Custom fields</li>
                        <li>Premium support</li>
                        <li>Encrypt SDK endpoint response</li>
                        <li>
                          Advanced experimentation features (CUPED, Sequential
                          testing, etc.)
                        </li>
                        <li>Early access to new features</li>
                      </ul>
                      <div
                        className={
                          "d-flex justify-content-between " +
                          (freeTrialAvailable ? "" : "mb-2")
                        }
                      >
                        <button
                          className="btn btn-primary m-3 w-100"
                          onClick={startPro}
                          disabled={isAtLeastPro && !license?.isTrial}
                        >
                          Upgrade Now
                        </button>
                      </div>
                      {freeTrialAvailable && !isCloud() && (
                        <div className="mb-4 text-center">
                          or, start a{" "}
                          {isAtLeastPro ? (
                            <span>{proTrialCopy}</span>
                          ) : (
                            <a
                              role="button"
                              className={clsx(
                                isAtLeastPro ? "cursor-default" : ""
                              )}
                              onClick={() =>
                                isCloud()
                                  ? setShowCloudProTrial(true)
                                  : setShowSHProTrial(true)
                              }
                            >
                              {proTrialCopy}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-lg-6 mb-4">
                  <div className="pl-lg-2 border rounded p-0 d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-center p-2 px-3">
                      <h4 className="mb-0">Enterprise</h4>
                      <div className="text-right text-muted">Contact Us</div>
                    </div>
                    <div className="border-top p-0 flex-grow-1">
                      <div className="mt-4 ml-3 font-italic">
                        Includes all Pro features, plus...
                      </div>
                      {/*The minHeight is a hack to get the two buttons aligned vertically */}
                      <ul className=" pr-2" style={{ minHeight: "168px" }}>
                        <li>
                          <b>Unlimited users</b>
                        </li>
                        <li>
                          <b>SSO / SAML integration</b>
                        </li>
                        <li>
                          <b>Roadmap acceleration</b>
                        </li>
                        <li>Service-level agreements</li>
                        <li>Exportable audit logs</li>
                        <li>Enterprise support and training</li>
                        <li>Advanced organization and performance</li>
                      </ul>
                      <div
                        className={
                          "d-flex justify-content-between " +
                          (freeTrialAvailable ? "" : "mb-2")
                        }
                      >
                        <button
                          className="btn btn-primary m-3 w-100"
                          onClick={startEnterprise}
                        >
                          Contact Us
                        </button>
                      </div>
                      {freeTrialAvailable && (
                        <div className="mb-4 text-center">
                          or,
                          <a
                            href="#"
                            className="ml-1"
                            onClick={() =>
                              isCloud()
                                ? setShowCloudEnterpriseTrial(true)
                                : setShowSHEnterpriseTrial(true)
                            }
                          >
                            request an Enterprise trial
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
        </Modal>
      )}
    </>
  );
}
