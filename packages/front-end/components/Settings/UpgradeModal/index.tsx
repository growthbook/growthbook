import { useEffect, useState } from "react";
import clsx from "clsx";
import { date } from "shared/dates";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FaCheckCircle } from "react-icons/fa";
import { PiCaretRight, PiArrowSquareOut } from "react-icons/pi";
import { CommercialFeature } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import { getGrowthBookBuild, isCloud } from "@/services/env";
import track from "@/services/track";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioCards from "@/ui/RadioCards";
import CloudProUpgradeModal from "@/enterprise/components/Billing/CloudProUpgradeModal";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import Callout from "@/ui/Callout";
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
  const [trialAndUpgradePreference, setTrialAndUpgradePreference] =
    useState<string>("upgrade");
  const [showSHProTrial, setShowSHProTrial] = useState(false);
  const [showSHProTrialSuccess, setShowSHProTrialSuccess] = useState(false);
  const [showSHEnterpriseTrial, setShowSHEnterpriseTrial] = useState(false);
  const [showSHEnterpriseTrialSuccess, setShowSHEnterpriseTrialSuccess] =
    useState(false);

  const [showCloudEnterpriseTrial, setShowCloudEnterpriseTrial] =
    useState(false);
  const [showCloudEnterpriseTrialSuccess, setShowCloudEnterpriseTrialSuccess] =
    useState(false);
  const [cloudProUpgradeSetup, setCloudProUpgradeSetup] = useState<{
    clientSecret: string;
  } | null>(null);
  const [showCloudProTrial, setShowCloudProTrial] = useState(false);
  const [showCloudProTrialSuccess, setShowCloudProTrialSuccess] =
    useState(false);
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

  const orgIsManagedByVercel = organization.isVercelIntegration;

  function shouldShowEnterpriseTreatment(): boolean {
    // Self-hosted Pro is not allowed, always show Enterprise
    if (!isCloud()) return true;

    // if no commercialFeature is provided, determine what plan to show based on org's current plan
    if (!commercialFeature) {
      if (
        !effectiveAccountPlan ||
        ["oss", "starter"].includes(effectiveAccountPlan)
      ) {
        return false;
      }

      return ["pro", "pro_sso"].includes(effectiveAccountPlan);
    } else {
      return commercialFeatureLowestPlan?.[commercialFeature] === "enterprise";
    }
  }

  const showEnterpriseTreatment = shouldShowEnterpriseTreatment();

  const currentUsers =
    (organization.members?.length || 0) + (organization.invites?.length || 0);

  // When signing up to pro, but not finishing the checkout process a license gets generated and saved but has no plan.
  const freeTrialAvailable =
    !license || !license.plan || !license.emailVerified;

  const now = new Date();

  const licensePlanText = license?.plan === "enterprise" ? "Enterprise" : "Pro";

  const notice =
    license?.dateExpires && new Date(license?.dateExpires) < now
      ? `${licensePlanText} license expired ${date(
          license.dateExpires || "",
        )}. Renew to regain access to ${licensePlanText} features and higher usage limits.`
      : null;

  const trackContext = {
    accountPlan,
    source,
    currentUsers,
    freeTrialAvailable,
  };

  const useInlineUpgradeForm = isCloud();

  useEffect(() => {
    track("View Upgrade Modal", trackContext);
    // Even if accountPlan gets update during this upgrade process, we don't want to call this track call multiple times
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            trackContext,
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
            trackContext,
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
    const newWindow = window.open(
      "https://www.growthbook.io/demo",
      "_blank",
      "noreferrer",
    );
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
        `There was a server error: ${txt}. Please try again later, or contact us at sales@growthbook.io`,
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
            "You already have an active license key. Contact us at sales@growthbook.io for more information.",
          );
          break;
        case "expired license exists":
          setError(
            "Your license key has already expired. Please contact us at sales@growthbook.io for more information.",
          );
          break;
        default:
          setError(
            `There was a server error: ${txt}. Please try again later, or contact us at sales@growthbook.io`,
          );
      }
    }
  };

  const bullets: Partial<Record<CommercialFeature, string>> = {
    "share-product-analytics-dashboards":
      "Create product analytics dashboards and control who can view and edit them.",
    "metric-groups": "Simplify experiment analysis with Metric Groups",
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
      "Estimate experiment duration using your data & get shipping recommendations",
    "custom-roles": "Create new roles with custom permissions",
    teams: "Organize members into teams to manage permissions centrally",
    "pipeline-mode":
      "Improve query performance and reduce data warehouse costs by up to 50%",
    "require-approvals":
      "Reduce errors by requiring approval flows when changing feature flag values",
    "audit-logging": "Easily export historical audit logs",
    "unlimited-managed-warehouse-usage":
      "Access to all your tracked events in the Managed Warehouse",
    saveSqlExplorerQueries:
      "Save query results and visualizations from the SQL Explorer.",
    holdouts: "Measure aggregate impact with Holdouts",
  };

  const upgradeHeader = (
    <>
      <h3
        className="mb-1"
        style={{ color: "var(--color-text-high)", fontSize: "20px" }}
      >
        {`Upgrade to ${showEnterpriseTreatment ? "Enterprise" : "Pro"}`}
      </h3>
      <p
        className="mb-0"
        style={{ color: "var(--color-text-mid)", fontSize: "16px" }}
      >
        {showEnterpriseTreatment
          ? "Contact Sales to access advanced experimentation tools, custom roles, and additional security features."
          : "Get instant access to advanced experimentation, permissioning and security features."}
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  function enterpriseTreatment() {
    const dynamicBullet = commercialFeature ? bullets[commercialFeature] : null;

    return (
      <div>
        {upgradeHeader}
        {notice && (
          <Box mt="4">
            <Callout status="error">{notice}</Callout>
          </Box>
        )}
        <div className="py-4">
          {dynamicBullet ? (
            <Tooltip
              body="* The 50% cost reduction figure is based on querying 30GB/day for an experiment with 10 metrics over a 14 day period, and is compared to the cost without pipeline mode enabled."
              shouldDisplay={commercialFeature === "pipeline-mode"}
            >
              <Flex align="center" className="pb-2">
                <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
                <Text
                  size={"3"}
                  style={{ color: "var(--color-text-high)", fontWeight: 500 }}
                >
                  {dynamicBullet}
                </Text>
              </Flex>
            </Tooltip>
          ) : null}
          {!["custom-roles", "teams"].includes(commercialFeature || "") ? (
            <Flex align="center" className="pb-2">
              <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
              <Text
                size={"3"}
                style={{ color: "var(--color-text-high)", fontWeight: 500 }}
              >
                Add unlimited team members, create custom roles, and organize
                members with Teams
              </Text>
            </Flex>
          ) : null}
          {commercialFeature !== "encrypt-features-endpoint" ? (
            <Flex align="center" className="pb-2">
              <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
              <Text
                size={"3"}
                style={{ color: "var(--color-text-high)", fontWeight: 500 }}
              >
                Encrypt SDK endpoint response
              </Text>
            </Flex>
          ) : null}
          <Flex align="center" className="pb-2">
            <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
            <Text
              size={"3"}
              style={{ color: "var(--color-text-high)", fontWeight: 500 }}
            >
              All Pro features + custom SLAs, roadmap acceleration, volume price
              discounts and more
            </Text>
          </Flex>
        </div>
      </div>
    );
  }

  function proTreatment() {
    const dynamicBullet = commercialFeature ? bullets[commercialFeature] : null;

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
              {dynamicBullet || "Add up to 50 team members"}
            </Text>
          </Flex>
          <Flex align="center" className="pb-2">
            <FaCheckCircle className="mr-2" color="var(--indigo-9)" />
            <Text
              size={"3"}
              style={{ color: "var(--color-text-high)", fontWeight: 500 }}
            >
              {dynamicBullet === "advanced-permissions"
                ? "Add up to 50 team members"
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
                  ${numOfCurrentMembers * 40} / month
                </Text>
              </Flex>
              <Box mb="5">
                <Text size="2">
                  $40 per seat per month, {numOfCurrentMembers} current seat
                  {numOfCurrentMembers > 1 ? "s" : ""}
                </Text>
              </Box>

              <table className="table table-sm border-bottom mb-3">
                <thead>
                  <tr>
                    <th>Usage Breakdown</th>
                    <th>
                      Included <small>(per month)</small>
                    </th>
                    <th>Additional</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialFeature ===
                    "unlimited-managed-warehouse-usage" && (
                    <tr>
                      <td>
                        Managed Warehouse{" "}
                        <Tooltip
                          body={
                            <>
                              <div className="mb-2">
                                Use our fully-managed data warehouse and event
                                pipeline.
                              </div>
                              <div>
                                OR bring your own for free (no usage charges).
                              </div>
                            </>
                          }
                        />
                      </td>
                      <td>2 million tracked events</td>
                      <td>$0.03 per thousand</td>
                    </tr>
                  )}
                  <tr style={{ borderBottom: 0 }}>
                    <td rowSpan={2}>
                      Global CDN{" "}
                      <Tooltip body="Stream feature flags to users with minimal latency. You also have the option to cache locally to reduce usage and costs." />
                    </td>
                    <td>2 million requests</td>
                    <td>$10 per million</td>
                  </tr>
                  <tr>
                    <td>20GB bandwidth</td>
                    <td>$1 per GB</td>
                  </tr>
                </tbody>
              </table>
              <p className="mb-0">
                <a
                  href="/settings/usage"
                  className="text-decoration-none pl-1"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    track(
                      "Clicked See Recent Usage From Upgrade Modal",
                      trackContext,
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
                <label>~${numOfCurrentMembers * 40} / month</label>
              </Flex>
              <p className="mb-0 text-secondary">
                $40 per seat per month, {numOfCurrentMembers} current seat
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
    if (showEnterpriseTreatment) {
      startEnterprise();
    } else {
      if (trialAndUpgradePreference === "upgrade") {
        await startPro();
        //MKTODO: Clean up this else block and simplify logic to remove trial option
      } else {
        await startProTrial(name, email);
      }
    }
  }

  // Safety check in case an Enterprise org found themselves here
  if (accountPlan === "enterprise") {
    return (
      <Modal
        trackingEventModalType="upgrade-modal"
        allowlistedTrackingEventProps={trackContext}
        open={true}
        includeCloseCta={true}
        closeCta="Close"
        close={close}
        size="lg"
        header={null}
        showHeaderCloseButton={false}
        ctaEnabled={permissionsUtil.canManageBilling()}
      >
        <Callout status="info" mr="5" mb="2">
          Your organization is already on GrowthBook&apos;s highest plan.
        </Callout>
      </Modal>
    );
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
      ) : orgIsManagedByVercel ? (
        <Modal
          trackingEventModalType="upgrade-modal"
          allowlistedTrackingEventProps={trackContext}
          open={true}
          includeCloseCta={true}
          closeCta="Close"
          close={close}
          size="md"
          header={null}
          showHeaderCloseButton={false}
        >
          <div>
            <h3 className="pb-2">
              Upgrade to {showEnterpriseTreatment ? "Enterprise" : "Pro"}
            </h3>
            <Callout status="info">
              You organization is currently managed by Vercel.
              {showEnterpriseTreatment ? (
                <span className="pl-1">
                  To upgrade to Enterprise, please email{" "}
                  <b>
                    <a
                      href="mailto:sales@growthbook.io"
                      target="_blank"
                      rel="noreferrer"
                      className="link-purple"
                    >
                      sales@growthbook.io
                    </a>
                  </b>
                  .
                </span>
              ) : (
                <span className="pl-1">
                  Please go to your Vercel Integration Dashboard and locate the
                  GrowthBook integration. From there, you can upgrade your
                  GrowthBook subscription via the <b>Settings </b>tab.
                </span>
              )}
            </Callout>
          </div>
        </Modal>
      ) : (
        <Modal
          trackingEventModalType="upgrade-modal"
          allowlistedTrackingEventProps={trackContext}
          open={true}
          autoCloseOnSubmit={false}
          includeCloseCta={true}
          close={close}
          size="lg"
          header={null}
          showHeaderCloseButton={false}
          loading={loading}
          cta={
            <>
              {showEnterpriseTreatment
                ? "Schedule Call"
                : trialAndUpgradePreference === "upgrade"
                  ? "Continue"
                  : "Start Trial"}
              <PiCaretRight />
            </>
          }
          disabledMessage="Contact your admin to upgrade."
          ctaEnabled={permissionsUtil.canManageBilling()}
          submit={onSubmit}
        >
          <div
            className={clsx(
              "container-fluid dashboard p-3 ",
              styles.upgradeModal,
            )}
          >
            {showEnterpriseTreatment ? enterpriseTreatment() : proTreatment()}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
        </Modal>
      )}
    </>
  );
}
