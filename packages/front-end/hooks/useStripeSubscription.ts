import { useEffect, useState } from "react";
import { SettingsApiResponse } from "../pages/settings";
import { useAuth } from "../services/auth";
import useApi from "./useApi";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const [subscriptionData, setSubscriptionData] = useState(null);
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const [seatsInFreeTier, setSeatsInFreeTier] = useState(null);
  const [pricePerSeat, setPricePerSeat] = useState(null);

  useEffect(() => {
    const getSubscriptionData = async () => {
      const { subscription } = await apiCall(`/subscription`);
      setSubscriptionData(subscription);
    };

    getSubscriptionData();
  }, []);

  useEffect(() => {
    const getSeatsInFreeTier = async () => {
      if (!subscriptionData && data.organization.price) {
        const { price } = await apiCall(`/price`);
        setSeatsInFreeTier(price.metadata.freeSeats);
        setPricePerSeat(price.metadata.price);
        return;
      }

      if (subscriptionData?.plan.metadata.freeSeats) {
        setSeatsInFreeTier(subscriptionData?.plan.metadata.freeSeats);
        setPricePerSeat(subscriptionData?.plan.metadata.price);
      } else {
        setSeatsInFreeTier(5);
        setPricePerSeat(20);
      }
    };

    getSeatsInFreeTier();
  }, [data]);

  const planName = subscriptionData?.plan.nickname;
  const nextBillDate = new Date(
    subscriptionData?.current_period_end * 1000
  ).toDateString();
  const dateToBeCanceled = new Date(
    subscriptionData?.cancel_at * 1000
  ).toDateString();
  const cancelationDate = new Date(
    subscriptionData?.canceled_at * 1000
  ).toDateString();
  const subscriptionStatus = subscriptionData?.status;
  const pendingCancelation = subscriptionData?.cancel_at_period_end;
  const discountedPricePerSeat =
    pricePerSeat * (subscriptionData?.discount?.coupon.percent_off / 100) ||
    null;

  const getStandardMonthlyPrice = () => {
    if (subscriptionData?.quantity < seatsInFreeTier) {
      return 0;
    } else {
      return pricePerSeat * (subscriptionData?.quantity - seatsInFreeTier);
    }
  };

  const getDiscountedMonthlyPrice = () => {
    if (subscriptionData?.quantity < seatsInFreeTier) {
      return 0;
    } else {
      return (
        discountedPricePerSeat * (subscriptionData?.quantity - seatsInFreeTier)
      );
    }
  };

  return {
    subscriptionData,
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
  };
}
