import { useMemo, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import type { ExpandedMember } from "shared/types/organization";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { type Team, useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import { useForceLicenseRefresh } from "@/hooks/useForceLicenseRefresh";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Modal from "@/components/Modal";
import UpgradeModal from "./UpgradeModal";
import UpdateOrbSubscriptionModal from "./UpdateOrbSubscriptionModal";

const CANCELLATION_SURVEY_URL = "https://form.typeform.com/to/kL75SA6F";

function isReadOnlySeatRole(role: string): boolean {
  return role === "readonly" || role === "noaccess";
}

function getSeatBreakdown(
  users: Map<string, ExpandedMember>,
  teams: Team[] | undefined,
): { fullMemberSeats: number; readOnlySeats: number } {
  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  let fullMemberSeats = 0;
  let readOnlySeats = 0;

  users.forEach((member) => {
    const roles = [member.role];
    member.projectRoles?.forEach((projectRole) => {
      roles.push(projectRole.role);
    });
    member.teams?.forEach((teamId) => {
      const team = teamById.get(teamId);
      if (!team) return;
      roles.push(team.role);
      team.projectRoles?.forEach((projectRole) => {
        roles.push(projectRole.role);
      });
    });

    if (roles.every(isReadOnlySeatRole)) {
      readOnlySeats += 1;
    } else {
      fullMemberSeats += 1;
    }
  });

  return { fullMemberSeats, readOnlySeats };
}

function seatLabel(count: number): string {
  return count === 1 ? "seat" : "seats";
}

function expirationDisplayDate(value: string | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  // Backend formats missing Stripe cancel_at as epoch (e.g. "Wed Dec 31 1969").
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() <= 1970) {
    return "";
  }
  return date(parsed);
}

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    subscription,
    seatsInUse,
    canSubscribe,
    accountPlan,
    users,
    organization,
    license,
    teams,
  } = useUser();
  const {
    status: organizationRefreshStatus,
    refresh: refreshOrganizationAfterCancellation,
    retry: retryOrganizationRefresh,
  } = useForceLicenseRefresh();

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [cancelSubscriptionModal, setCancelSubscriptionModal] = useState(false);
  const [showCancellationSurveyModal, setShowCancellationSurveyModal] =
    useState(false);
  const [updateOrbSubscriptionModal, setUpdateOrbSubscriptionModal] =
    useState(false);

  // Orb subscriptions only count members, not members + invites like Stripe Subscriptions
  const subscriptionSeats =
    subscription?.billingPlatform === "orb" ? users.size : seatsInUse;
  const { fullMemberSeats, readOnlySeats } = useMemo(
    () => getSeatBreakdown(users, teams),
    [users, teams],
  );

  const hasActiveOrbSubscription =
    subscription?.billingPlatform === "orb" &&
    subscription?.status === "active" &&
    subscription?.nextBillDate &&
    !subscription?.pendingCancelation;

  const showOrbInvoiceBlockedCallout =
    subscription?.billingPlatform === "orb" &&
    subscription?.status === "active" &&
    !subscription?.stripeCustomerId;

  const showStripeManageButton = subscription?.billingPlatform === "stripe";
  const showUpdateInvoiceButton =
    subscription?.billingPlatform === "orb" &&
    subscription?.status === "active" &&
    !!subscription?.stripeCustomerId;
  const showRenewButton = subscription?.status === "canceled" && canSubscribe;
  const isEnterprise = accountPlan === "enterprise";
  const showCancelButton = hasActiveOrbSubscription && !isEnterprise;
  const contractExpirationDate =
    expirationDisplayDate(license?.dateExpires) ||
    expirationDisplayDate(subscription?.dateToBeCanceled);
  const showActionButtons =
    showStripeManageButton ||
    showUpdateInvoiceButton ||
    showRenewButton ||
    showCancelButton;

  return (
    <div className="p-3">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="billing-renew"
          commercialFeature={null}
        />
      )}
      {showCancellationSurveyModal && (
        <Modal
          useRadixButton={false}
          open={true}
          header={null}
          trackingEventModalType="cancellation-survey"
          close={() => setShowCancellationSurveyModal(false)}
          submit={async () => {
            const surveyUrl = new URL(CANCELLATION_SURVEY_URL);

            if (organization.id) {
              surveyUrl.searchParams.set("org_id", organization.id);
            }

            window.open(surveyUrl.toString(), "_blank");
            setShowCancellationSurveyModal(false);
          }}
          cta="Share Feedback"
          closeCta="No thanks"
          showHeaderCloseButton={false}
        >
          <Box mr="5">
            <Text as="p" size="3" weight="medium">
              How can we improve?
            </Text>
            <Text as="span">
              Can you spare 30 seconds to let us know what we can do better?
            </Text>
          </Box>
        </Modal>
      )}
      {cancelSubscriptionModal && (
        <Modal
          useRadixButton={false}
          open={true}
          header="Are you sure you want to cancel?"
          trackingEventModalType="cancel-subscription"
          close={() => setCancelSubscriptionModal(false)}
          cta="Yes, Cancel Subscription"
          closeCta="Keep Subscription"
          submitColor="danger"
          submit={async () => {
            await apiCall("/subscription/cancel", { method: "POST" });
            await refreshOrganizationAfterCancellation();
            setCancelSubscriptionModal(false);
            setShowCancellationSurveyModal(true);
          }}
        >
          <>
            <p>
              If you cancel, you will continue to have access to your
              <strong> {planNameFromAccountPlan(accountPlan)} Plan </strong>
              features until your current billing period ends on{" "}
              {subscription?.nextBillDate}.
            </p>
            <Callout status="warning">
              You account can still accrue CDN usage charges. If you&apos;d like
              to prevent that, you can remove Growthbook SDK from your code
              base.
            </Callout>
          </>
        </Modal>
      )}
      {updateOrbSubscriptionModal && (
        <StripeProvider>
          <UpdateOrbSubscriptionModal
            subscription={subscription || undefined}
            close={() => setUpdateOrbSubscriptionModal(false)}
          />
        </StripeProvider>
      )}
      {organizationRefreshStatus !== "idle" ? (
        <Callout
          status="warning"
          mb="3"
          action={
            <Button
              size="sm"
              color="inherit"
              loading={organizationRefreshStatus === "loading"}
              onClick={retryOrganizationRefresh}
            >
              Try again
            </Button>
          }
        >
          We couldn&apos;t refresh your organization details. Try again to see
          your updated plan.
        </Callout>
      ) : null}
      <div className="col-auto mb-3">
        <strong>Current Plan:</strong> {isCloud() ? "Cloud" : "Self-Hosted"}{" "}
        {planNameFromAccountPlan(accountPlan)}
        {subscription?.status === "trialing" && (
          <>
            {" "}
            <em>(trial)</em>
          </>
        )}
      </div>
      <div className="col-md-12 mb-3">
        <strong>Number Of Seats:</strong> {subscriptionSeats || 0}
        {readOnlySeats > 0 ? (
          <Text as="div" color="gray" size="2">
            This includes {readOnlySeats} read-only {seatLabel(readOnlySeats)}{" "}
            and {fullMemberSeats} full-member {seatLabel(fullMemberSeats)}.
          </Text>
        ) : null}
      </div>
      {isEnterprise && contractExpirationDate ? (
        <Box mb="3" ml="2">
          <strong>Contract Expiration:</strong> {contractExpirationDate}
        </Box>
      ) : null}
      {subscription?.status !== "canceled" &&
        !subscription?.pendingCancelation && (
          <div className="col-md-12 mb-3">
            <div>
              <strong>Next Bill Date: </strong>
              {subscription?.nextBillDate}
            </div>
            {subscription?.hasPaymentMethod === true ? (
              <Box maxWidth="650px" mt="3">
                <Callout status="success">
                  You have a valid payment method on file. You will be billed
                  automatically on this date.
                </Callout>
              </Box>
            ) : subscription?.hasPaymentMethod === false &&
              accountPlan !== "enterprise" ? (
              <Box maxWidth="550px" mt="3">
                <Callout status="warning">
                  <p>
                    You do not have a valid payment method on file. Your
                    subscription will be cancelled on this date unless you add a
                    valid payment method.
                  </p>
                  <p className="mb-0">
                    Click <strong>View Plan Details</strong> below to add a
                    payment method.
                  </p>
                </Callout>
              </Box>
            ) : null}
          </div>
        )}
      {subscription?.pendingCancelation &&
        subscription?.dateToBeCanceled &&
        !isEnterprise && (
          <Callout status="error" mb="3">
            Your plan will be canceled, but is still available until the end of
            your billing period on
            {` ${subscription?.dateToBeCanceled}.`}
          </Callout>
        )}
      {subscription?.status === "canceled" && (
        <Callout status="error" mb="3">
          Your plan was canceled on {` ${subscription?.cancelationDate}.`}
        </Callout>
      )}
      {showOrbInvoiceBlockedCallout ? (
        <Box maxWidth="550px" mt="4" mb="3">
          <Callout status="info">
            To make changes to your subscription, please contact your account
            executive or{" "}
            <a href="mailto:support@growthbook.io">support@growthbook.io</a>.
          </Callout>
        </Box>
      ) : null}
      {showActionButtons ? (
        <Flex
          mt={showOrbInvoiceBlockedCallout ? "0" : "4"}
          mb="3"
          gap="3"
          align="center"
          wrap="wrap"
        >
          {showStripeManageButton ? (
            <Button
              onClick={async () => {
                const res = await apiCall<{ url: string }>(
                  `/subscription/manage`,
                  {
                    method: "POST",
                  },
                );
                if (res && res.url) {
                  await redirectWithTimeout(res.url);
                } else {
                  throw new Error("Unknown response");
                }
              }}
            >
              {subscription?.status !== "canceled"
                ? "View Plan Details"
                : "View Previous Invoices"}
            </Button>
          ) : null}
          {showUpdateInvoiceButton ? (
            <Button onClick={() => setUpdateOrbSubscriptionModal(true)}>
              Update Invoice Details
            </Button>
          ) : null}
          {showRenewButton ? (
            <Button onClick={() => setUpgradeModal(true)}>
              Renew Your Plan
            </Button>
          ) : null}
          {showCancelButton ? (
            <Button
              color="red"
              onClick={() => setCancelSubscriptionModal(true)}
            >
              Cancel Subscription
            </Button>
          ) : null}
        </Flex>
      ) : null}
    </div>
  );
}
