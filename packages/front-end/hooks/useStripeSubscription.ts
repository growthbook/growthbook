import { useEffect, useState } from "react";
import { useAuth } from "../services/auth";

export default function useStripeSubscription() {
  const { apiCall } = useAuth();
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [seatsInFreeTier, setSeatsInFreeTier] = useState(null);
  const [pricePerSeat, setPricePerSeat] = useState(null);

  useEffect(() => {
    const getSubscriptionData = async () => {
      const { subscriptionData } = await apiCall(`/subscription`);
      setSubscriptionData(subscriptionData);

      const { priceData } = await apiCall(`/price`);
      setSeatsInFreeTier(priceData.tiers[0].up_to);
      setPricePerSeat(priceData.tiers[1].unit_amount / 100);
    };

    getSubscriptionData();
  }, []);

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
