import { useEffect, useState } from "react";
import { OrganizationInterface } from "../../back-end/types/organization";
import { useAuth } from "../services/auth";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const { data } = useApi<{
    organization: OrganizationInterface;
  }>(`/organization`);
  const [pricePerSeat, setPricePerSeat] = useState(null);

  useEffect(() => {
    const getPriceData = async () => {
      const { priceData } = await apiCall(`/subscription-data`);
      setPricePerSeat(priceData.pricePerSeat);
    };

    getPriceData();
  }, []);

  const freeSeats = data.organization.freeSeats || 3;

  const numberOfCurrentSeats = data.organization.subscription?.qty || 0;

  const activeAndInvitedUsers =
    data.organization.members.length + data.organization.invites.length;

  const hasActiveSubscription =
    data.organization.subscription?.status === "active" ||
    data.organization.subscription?.status === "trialing" ||
    // We will treat past_due as active so as to not interrupt users
    data.organization.subscription?.status === "past_due";

  const planName = data.organization.subscription?.planNickname;

  const nextBillDate = new Date(
    data.organization.subscription?.current_period_end * 1000
  ).toDateString();

  const dateToBeCanceled = new Date(
    data.organization.subscription?.cancel_at * 1000
  ).toDateString();

  const cancelationDate = new Date(
    data.organization.subscription?.canceled_at * 1000
  ).toDateString();

  const subscriptionStatus = data.organization.subscription?.status;

  const pendingCancelation =
    data.organization.subscription?.cancel_at_period_end;

  const monthlyPrice =
    pricePerSeat * (numberOfCurrentSeats - (data.organization.freeSeats || 0));

  const disableSelfServeBilling =
    data.organization.disableSelfServeBilling || false;

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
    disableSelfServeBilling,
  };
}
