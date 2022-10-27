import { useUser } from "../../../services/UserContext";
import { isCloud } from "../../../services/env";
import useStripeSubscription from "../../../hooks/useStripeSubscription";

export default function RoleUpgradeMessage({
  showUpgradeModal,
  newUser,
}: {
  showUpgradeModal: () => void;
  newUser: boolean;
}) {
  const {
    canSubscribe,
    freeSeats,
    activeAndInvitedUsers,
  } = useStripeSubscription();
  const { hasCommercialFeature } = useUser();

  if (hasCommercialFeature("advanced-permissions")) return null;

  if (isCloud()) {
    if (!canSubscribe) return null;
    const seatsRemaining = freeSeats - activeAndInvitedUsers;
    return (
      <div className="alert alert-info">
        {newUser && seatsRemaining > 0 && (
          <>
            You have {seatsRemaining} free seat{" "}
            {seatsRemaining === 1 ? "" : "s"} remaining.{" "}
          </>
        )}
        Upgrade your plan to enable advanced, per-environment and per-project
        permissioning.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            showUpgradeModal();
          }}
        >
          Learn More
        </a>
      </div>
    );
  }

  // Self-hosted
  return (
    <div className="alert alert-info">
      Purchase a commercial license key to enable advanced, per-environment and
      per-project permissioning. Contact{" "}
      <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for more
      info.
    </div>
  );
}
