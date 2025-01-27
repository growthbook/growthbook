import useStripeSubscription from "@/hooks/useStripeSubscription";
import LoadingOverlay from "@/components/LoadingOverlay";
import OrbSubscriptionInfo from "./OrbSubscriptionInfo";
import StripeSubscriptionInfo from "./StripeSubscriptionInfo";

export default function SubscriptionInfo() {
  const { loading, subscriptionType } = useStripeSubscription();

  if (loading) return <LoadingOverlay />;

  return (
    <>
      {subscriptionType === "orb" ? (
        <OrbSubscriptionInfo />
      ) : (
        <StripeSubscriptionInfo />
      )}
    </>
  );
}
