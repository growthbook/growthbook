import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import { useForceLicenseRefresh } from "@/hooks/useForceLicenseRefresh";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Modal from "@/components/Modal";
import UpgradeModal from "./UpgradeModal";
import UpdateOrbSubscriptionModal from "./UpdateOrbSubscriptionModal";

const CANCELLATION_SURVEY_URL = "https://form.typeform.com/to/kL75SA6F";

export default function SubscriptionInfo() {
  const { apiCall } = useAuth();
  const {
    subscription,
    seatsInUse,
    canSubscribe,
    accountPlan,
    users,
    organization,
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

  const hasActiveOrbSubscription =
    subscription?.billingPlatform === "orb" &&
    subscription?.status === "active" &&
    subscription?.nextBillDate &&
    !subscription?.pendingCancelation;

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
      </div>
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
      {subscription?.pendingCancelation && subscription?.dateToBeCanceled && (
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
      <Flex mt="4" mb="3" gap="3" align="center" wrap="wrap">
        {subscription?.billingPlatform === "stripe" ? (
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
        {subscription?.billingPlatform === "orb" &&
        subscription?.status === "active" ? (
          subscription?.stripeCustomerId ? (
            <Button onClick={() => setUpdateOrbSubscriptionModal(true)}>
              Update Invoice Details
            </Button>
          ) : (
            <Box maxWidth="550px">
              <Callout status="info">
                To make changes to your subscription, please contact your
                account executive or support@growthbook.io.
              </Callout>
            </Box>
          )
        ) : null}
        {subscription?.status === "canceled" && canSubscribe ? (
          <Button onClick={() => setUpgradeModal(true)}>Renew Your Plan</Button>
        ) : null}
        {hasActiveOrbSubscription && accountPlan !== "enterprise" ? (
          <Button color="red" onClick={() => setCancelSubscriptionModal(true)}>
            Cancel Subscription
          </Button>
        ) : null}
      </Flex>
    </div>
  );
}
