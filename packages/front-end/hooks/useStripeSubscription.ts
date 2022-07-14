import { useEffect, useState } from "react";
import { useAuth } from "../services/auth";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const [subscriptionData, setSubscriptionData] = useState(null);

  useEffect(() => {
    const getSubscriptionData = async () => {
      const { subscription } = await apiCall(`/subscription`);
      setSubscriptionData(subscription);
    };

    getSubscriptionData();
  }, []);

  const seatsInFreeTier = subscriptionData?.plan.metadata.freeSeats || 5;
  const pricePerSeat = subscriptionData?.plan.metadata.price || 20;
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
    pricePerSeat * (subscriptionData?.discount?.coupon.percent_off / 100);
  console.log(discountedPricePerSeat);

  const standardMonthlyPrice =
    pricePerSeat * (subscriptionData?.quantity - seatsInFreeTier);
  const discountedMonthlyPrice =
    discountedPricePerSeat * (subscriptionData?.quantity - seatsInFreeTier);

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
    standardMonthlyPrice,
    discountedMonthlyPrice,
  };
}
