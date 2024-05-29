import { useFeature } from "@growthbook/growthbook-react";
import { SubscriptionQuote } from "back-end/types/organization";
import { useEffect, useState } from "react";
import { getValidDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "./usePermissionsUtils";

export default function useStripeSubscription() {
  const selfServePricingEnabled = useFeature("self-serve-billing").on;
  const showSeatOverageBanner = useFeature(
    "self-serve-billing-overage-warning-banner"
  ).on;

  const { organization, license } = useUser();

  //TODO: Remove this once we have moved the license off the organization
  const stripeSubscription =
    license?.stripeSubscription || organization?.subscription;

  const freeSeats = organization?.freeSeats || 3;

  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  useEffect(() => {
    if (!permissionsUtil.canManageBilling()) return;

    apiCall<{ quote: SubscriptionQuote }>(`/subscription/quote`)
      .then((data) => {
        setQuote(data.quote);
      })
      .catch((e) => console.error(e));
  }, [freeSeats, permissionsUtil]);

  const activeAndInvitedUsers = quote?.activeAndInvitedUsers || 0;

  const subscriptionStatus = stripeSubscription?.status;

  const hasPaymentMethod = stripeSubscription?.hasPaymentMethod;

  // We will treat past_due as active so as to not interrupt users
  const hasActiveSubscription = ["active", "trialing", "past_due"].includes(
    subscriptionStatus || ""
  );

  const nextBillDate = new Date(
    (stripeSubscription?.current_period_end || 0) * 1000
  ).toDateString();

  const dateToBeCanceled = new Date(
    (stripeSubscription?.cancel_at || 0) * 1000
  ).toDateString();

  const cancelationDate = new Date(
    (stripeSubscription?.canceled_at || 0) * 1000
  ).toDateString();

  const pendingCancelation =
    stripeSubscription?.status !== "canceled" &&
    stripeSubscription?.cancel_at_period_end;

  const disableSelfServeBilling =
    organization?.disableSelfServeBilling || false;

  // eslint-disable-next-line
  let trialEnd = (stripeSubscription?.trialEnd || null) as any;
  if (typeof trialEnd === "number") {
    trialEnd = getValidDate(trialEnd * 1000);
  }

  const canSubscribe = () => {
    if (disableSelfServeBilling) return false;

    if (organization?.enterprise) return false; //TODO: Remove this once we have moved the license off the organization

    if (license?.plan === "enterprise") return false;

    // if already on pro, they must have a stripeSubscription - some self-hosted pro have an annual contract not directly through stripe.
    if (
      license &&
      ["pro", "pro_sso"].includes(license.plan || "") &&
      !license.stripeSubscription
    )
      return false;

    if (!selfServePricingEnabled) return false;

    if (hasActiveSubscription) return false;

    return true;
  };

  return {
    freeSeats,
    quote: quote,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    hasPaymentMethod,
    pendingCancelation,
    activeAndInvitedUsers,
    hasActiveSubscription,
    trialEnd: trialEnd as null | Date,
    showSeatOverageBanner,
    loading: !quote || !organization,
    canSubscribe: canSubscribe(),
  };
}
