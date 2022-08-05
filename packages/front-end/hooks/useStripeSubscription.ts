import { useEffect, useState } from "react";
import { SettingsApiResponse } from "../pages/settings";
import { useAuth } from "../services/auth";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const [discountData, setDiscountData] = useState(null);
  const [pricePerSeat, setPricePerSeat] = useState(null);
  const { data } = useApi<SettingsApiResponse>(`/organization`);

  useEffect(() => {
    const getPriceData = async () => {
      const { priceData } = await apiCall(`/price`);

      if (priceData) {
        setPricePerSeat(priceData.unit_amount / 100);
      } else {
        setPricePerSeat(20);
      }

      const { discountCodeData } = await apiCall(`/discount-code`);
      if (discountCodeData) {
        setDiscountData(discountCodeData);
      }
    };

    getPriceData();
  }, []);

  const freeSeats = data.organization.freeSeats || 2;

  const numberOfCurrentSeats = data.organization.subscription?.qty || 0;

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

  const getMonthlyPrice = () => {
    // This calculates price of grandfathered organizations
    if (discountData?.amount_off) {
      const price =
        pricePerSeat * data.organization.subscription.qty -
        discountData.amount_off / 100;

      if (price <= 0) {
        return 0;
      } else {
        return price;
      }
      // This calculates the price is the organization has a percent off coupon
    } else if (discountData?.percent_off) {
      return (
        pricePerSeat *
        data.organization.subscription.qty *
        (discountData.percent_off / 100)
      );
      // This calculates the price of a standard organization
    } else {
      return pricePerSeat * data.organization.subscription.qty;
    }
  };

  return {
    freeSeats,
    pricePerSeat,
    planName,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    subscriptionStatus,
    pendingCancelation,
    getMonthlyPrice,
    activeAndInvitedUsers,
    numberOfCurrentSeats,
    hasActiveSubscription,
  };
}
