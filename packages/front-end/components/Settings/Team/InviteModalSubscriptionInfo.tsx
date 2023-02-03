import useStripeSubscription from "@/hooks/useStripeSubscription";
import { isCloud } from "@/services/env";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export default function InviteModalSubscriptionInfo() {
  const {
    freeSeats,
    hasActiveSubscription,
    activeAndInvitedUsers,
    quote,
    loading,
  } = useStripeSubscription();
  if (loading) return null;

  if (!hasActiveSubscription || !isCloud()) return null;
  if (activeAndInvitedUsers < freeSeats) return null;

  return (
    <p className="mt-3 mb-0 alert-warning alert">
      This user will be assigned a new seat{" "}
      {quote?.additionalSeatPrice && (
        <strong>
          ({currencyFormatter.format(quote.additionalSeatPrice || 0)}
          /month).
        </strong>
      )}
    </p>
  );
}
