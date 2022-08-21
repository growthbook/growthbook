import { useFeature } from "@growthbook/growthbook-react";
import { useEffect, useState } from "react";
import { OrganizationInterface } from "../../back-end/types/organization";
import { useAuth } from "../services/auth";
import { getValidDate } from "../services/dates";
import { isCloud } from "../services/env";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const { data } = useApi<{
    organization: OrganizationInterface;
  }>(`/organization`);
  const selfServePricingEnabled = useFeature("self-serve-billing").on;
  const showSeatOverageBanner = useFeature(
    "self-serve-billing-overage-warning-banner"
  ).on;
  const [pricePerSeat, setPricePerSeat] = useState(null);

  useEffect(() => {
    const getPriceData = async () => {
      const { priceData } = await apiCall(`/subscription-data`);
      setPricePerSeat(priceData.pricePerSeat);
    };

    getPriceData();
  }, []);

  const freeSeats = data?.organization?.freeSeats || 3;

  const numberOfCurrentSeats = data?.organization?.subscription?.qty || 0;

  const activeAndInvitedUsers =
    (data?.organization?.members?.length || 0) +
    (data?.organization?.invites?.length || 0);

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

  const monthlyPrice =
    pricePerSeat *
    (numberOfCurrentSeats - (data?.organization?.freeSeats || 0));

  const disableSelfServeBilling =
    data?.organization?.disableSelfServeBilling || false;

  const freeSeatsExcluded =
    (data?.organization?.freeSeatsExcluded &&
      data?.organization?.discountCode) ||
    false;

  // eslint-disable-next-line
  let trialEnd = (data?.organization?.subscription?.trialEnd || null) as any;
  if (trialEnd) {
    trialEnd = getValidDate(trialEnd * 1000);
  }

  return {
    freeSeats,
    pricePerSeat,
    monthlyPrice,
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    activeAndInvitedUsers,
    numberOfCurrentSeats,
    hasActiveSubscription,
    trialEnd: trialEnd as null | Date,
    showSeatOverageBanner,
    loading: pricePerSeat === null || !data,
    freeSeatDiscount: freeSeatsExcluded ? -1 * freeSeats * pricePerSeat : 0,
    canSubscribe:
      isCloud() &&
      !disableSelfServeBilling &&
      selfServePricingEnabled &&
      !hasActiveSubscription,
  };
}
