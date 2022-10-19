import { useFeature } from "@growthbook/growthbook-react";
import { SubscriptionQuote } from "back-end/types/organization";
import { useEffect, useState } from "react";
import { useAuth } from "../services/auth";
import { getValidDate } from "../services/dates";
import { isCloud } from "../services/env";
import { useAdminSettings } from "./useAdminSettings";
import usePermissions from "./usePermissions";

export default function useStripeSubscription() {
  const { data } = useAdminSettings();
  const selfServePricingEnabled = useFeature("self-serve-billing").on;
  const showSeatOverageBanner = useFeature(
    "self-serve-billing-overage-warning-banner"
  ).on;

  const freeSeats = data?.organization?.freeSeats || 3;

  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);

  const { apiCall } = useAuth();
  const permissions = usePermissions();
  useEffect(() => {
    if (!permissions.manageBilling) return;
    if (!isCloud()) return;

    apiCall<{ quote: SubscriptionQuote }>(`/subscription/quote`)
      .then((data) => {
        setQuote(data.quote);
      })
      .catch((e) => console.error(e));
  }, [freeSeats, isCloud(), permissions.manageBilling]);

  const activeAndInvitedUsers = quote?.activeAndInvitedUsers || 0;

  const subscriptionStatus = data?.organization?.subscription?.status;

  // We will treat past_due as active so as to not interrupt users
  const hasActiveSubscription = ["active", "trialing", "past_due"].includes(
    subscriptionStatus || ""
  );

  const planName = data?.organization?.subscription?.planNickname || "";

  const nextBillDate = new Date(
    (data?.organization?.subscription?.current_period_end || 0) * 1000
  ).toDateString();

  const dateToBeCanceled = new Date(
    (data?.organization?.subscription?.cancel_at || 0) * 1000
  ).toDateString();

  const cancelationDate = new Date(
    (data?.organization?.subscription?.canceled_at || 0) * 1000
  ).toDateString();

  const pendingCancelation =
    data?.organization?.subscription?.cancel_at_period_end;

  const disableSelfServeBilling =
    data?.organization?.disableSelfServeBilling || false;

  // eslint-disable-next-line
  let trialEnd = (data?.organization?.subscription?.trialEnd || null) as any;
  if (trialEnd) {
    trialEnd = getValidDate(trialEnd * 1000);
  }

  return {
    freeSeats,
    quote: quote,
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    activeAndInvitedUsers,
    hasActiveSubscription,
    trialEnd: trialEnd as null | Date,
    showSeatOverageBanner,
    loading: !quote || !data,
    canSubscribe:
      isCloud() &&
      !disableSelfServeBilling &&
      selfServePricingEnabled &&
      !hasActiveSubscription,
  };
}
