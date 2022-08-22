import useStripeSubscription from "../../hooks/useStripeSubscription";

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
    canSubscribe,
    loading,
  } = useStripeSubscription();
  if (loading) return null;

  return (
    <>
      {activeAndInvitedUsers < freeSeats && canSubscribe && (
        <p className="mt-3 mb-0 alert alert-info">{`You have ${
          freeSeats - activeAndInvitedUsers
        } free seat${
          freeSeats - activeAndInvitedUsers > 1 ? "s" : ""
        } remaining.`}</p>
      )}
      {activeAndInvitedUsers >= freeSeats && hasActiveSubscription && (
        <p className="mt-3 mb-0 alert-warning alert">
          This user will be assigned a new seat{" "}
          {quote?.additionalSeatPrice && (
            <strong>
              ({currencyFormatter.format(quote.additionalSeatPrice || 0)}
              /month).
            </strong>
          )}
        </p>
      )}
    </>
  );
}
