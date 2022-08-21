import useStripeSubscription from "../../hooks/useStripeSubscription";

export default function InviteModalSubscriptionInfo() {
  const {
    activeAndInvitedUsers,
    freeSeats,
    hasActiveSubscription,
    pricePerSeat,
    numberOfCurrentSeats,
    canSubscribe,
  } = useStripeSubscription();
  return (
    <>
      {activeAndInvitedUsers < freeSeats && canSubscribe && (
        <p className="mt-3 mb-0 alert alert-info">{`You have ${
          freeSeats - activeAndInvitedUsers
        } free seat${
          freeSeats - activeAndInvitedUsers > 1 ? "s" : ""
        } remaining.`}</p>
      )}
      {activeAndInvitedUsers >= freeSeats &&
        numberOfCurrentSeats <= activeAndInvitedUsers &&
        hasActiveSubscription && (
          <p className="mt-3 mb-0 alert-warning alert">
            This user will be assigned a new seat{" "}
            {pricePerSeat && (
              <strong>
                (${pricePerSeat}
                /month).
              </strong>
            )}
          </p>
        )}
    </>
  );
}
