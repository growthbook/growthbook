import { useFeature } from "@growthbook/growthbook-react";
import {
  OrganizationInterface,
  SubscriptionQuote,
} from "../../back-end/types/organization";
import { getValidDate } from "../services/dates";
import { isCloud } from "../services/env";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { data } = useApi<{
    organization: OrganizationInterface;
  }>(`/organization`);

  const { data: quoteData } = useApi<{
    quote: SubscriptionQuote;
  }>(`/subscription/quote`);

  const selfServePricingEnabled = useFeature("self-serve-billing").on;
  const showSeatOverageBanner = useFeature(
    "self-serve-billing-overage-warning-banner"
  ).on;

  const freeSeats = data?.organization?.freeSeats || 3;

  const activeAndInvitedUsers = quoteData?.quote?.qty || 0;

  const hasActiveSubscription =
    data?.organization?.subscription?.status === "active" ||
    data?.organization?.subscription?.status === "trialing" ||
    // We will treat past_due as active so as to not interrupt users
    data?.organization?.subscription?.status === "past_due";

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

  const subscriptionStatus = data?.organization?.subscription?.status;

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
    quote: quoteData?.quote,
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
    loading: !quoteData || !data,
    canSubscribe:
      isCloud() &&
      !disableSelfServeBilling &&
      selfServePricingEnabled &&
      !hasActiveSubscription,
  };
}
