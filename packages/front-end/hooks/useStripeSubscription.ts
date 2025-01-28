import { useFeature } from "@growthbook/growthbook-react";
import { useUser } from "@/services/UserContext";

export default function useStripeSubscription() {
  const selfServePricingEnabled = useFeature("self-serve-billing").on;
  const showSeatOverageBanner = useFeature(
    "self-serve-billing-overage-warning-banner"
  ).on;

  const { organization, license } = useUser();

  //TODO: Remove this once we have moved the license off the organization
  const stripeSubscription =
    license?._stripeSubscription || organization?.subscription;

  const freeSeats = organization?.freeSeats || 3;

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

  const canSubscribe = () => {
    if (disableSelfServeBilling) return false;

    if (organization?.enterprise) return false; //TODO: Remove this once we have moved the license off the organization

    if (license?.plan === "enterprise") return false;

    // if already on pro, they must have a stripeSubscription - some self-hosted pro have an annual contract not directly through stripe.
    if (
      license &&
      ["pro", "pro_sso"].includes(license.plan || "") &&
      !license._stripeSubscription
    )
      return false;

    if (!selfServePricingEnabled) return false;

    if (hasActiveSubscription) return false;

    return true;
  };

  return {
    freeSeats,
    nextBillDate,
    dateToBeCanceled,
    cancelationDate,
    hasPaymentMethod,
    pendingCancelation,
    showSeatOverageBanner,
    canSubscribe: canSubscribe(),
  };
}
