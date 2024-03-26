import useStripeSubscription from "@/hooks/useStripeSubscription";
import { useUser } from "@/services/UserContext";

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
  const { license } = useUser();
  if (loading) return null;

  if (!hasActiveSubscription) return null;
  if (activeAndInvitedUsers < freeSeats) return null;

  return (
    <p className="mt-3 mb-0 alert-warning alert">
      This user will be assigned a new seat, which will cost an extra{" "}
      {quote?.additionalSeatPrice && (
        <strong>
          ({currencyFormatter.format(quote.additionalSeatPrice || 0)}
          /month)
        </strong>
      )}
      {license?.isTrial ? " once your trial ends" : ""}.
    </p>
  );
}
