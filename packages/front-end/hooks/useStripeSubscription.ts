import { useEffect, useState } from "react";
import { SettingsApiResponse } from "../pages/settings";
import { useAuth } from "../services/auth";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const [seatsInFreeTier, setSeatsInFreeTier] = useState(null);
  const [pricePerSeat, setPricePerSeat] = useState(null);
  const { data } = useApi<SettingsApiResponse>(`/organization`);

  useEffect(() => {
    const getPriceData = async () => {
      const { priceData } = await apiCall(`/price`);
      setSeatsInFreeTier(priceData.tiers[0].up_to);
      setPricePerSeat(priceData.tiers[1].unit_amount / 100);
    };

    getPriceData();
  }, []);

  const numberOfCurrentSeats = data.organization.subscription.qty || 0;

  const activeAndInvitedUsers =
    data.organization.members.length + data.organization.invites.length;

  const hasActiveSubscription =
    data.organization.subscription?.status === "active" ||
    data.organization.subscription?.status === "trialing";

  const planName = data.organization.subscription.planNickname;

  const nextBillDate = new Date(
    data.organization.subscription.current_period_end * 1000
  ).toDateString();

  const dateToBeCanceled = new Date(
    data.organization.subscription.cancel_at * 1000
  ).toDateString();

  const cancelationDate = new Date(
    data.organization.subscription.canceled_at * 1000
  ).toDateString();

  const subscriptionStatus = data.organization.subscription.status;

  const pendingCancelation =
    data.organization.subscription.cancel_at_period_end;

  const discountedPricePerSeat =
    pricePerSeat * (data.organization.subscription.percent_off / 100) || null;

  const getStandardMonthlyPrice = () => {
    if (data.organization.subscription.qty < seatsInFreeTier) {
      return 0;
    } else {
      return (
        pricePerSeat * (data.organization.subscription.qty - seatsInFreeTier)
      );
    }
  };

  const getDiscountedMonthlyPrice = () => {
    if (data.organization.subscription.qty < seatsInFreeTier) {
      return 0;
    } else {
      return (
        discountedPricePerSeat *
        (data.organization.subscription.qty - seatsInFreeTier)
      );
    }
  };

  return {
    seatsInFreeTier,
    pricePerSeat,
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    discountedPricePerSeat,
    getStandardMonthlyPrice,
    getDiscountedMonthlyPrice,
    activeAndInvitedUsers,
    numberOfCurrentSeats,
    hasActiveSubscription,
    data,
  };
}
