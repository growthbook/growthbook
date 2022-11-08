import { useUser } from "../../services/UserContext";
import { isCloud } from "../../services/env";
import useStripeSubscription from "../../hooks/useStripeSubscription";

export default function RoleUpgradeMessage({
  showUpgradeModal,
}: {
  showUpgradeModal: () => void;
}) {
  const { canSubscribe } = useStripeSubscription();
  const { hasCommercialFeature } = useUser();

  if (hasCommercialFeature("advanced-permissions")) return null;

  if (isCloud()) {
    return (
      <div className="alert alert-info">
        Upgrade your plan to encrypt the response from this SDK endpoint.{" "}
        {canSubscribe ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              showUpgradeModal();
            }}
          >
            Learn More
          </a>
        ) : (
          <>
            Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
            for more info.
          </>
        )}
      </div>
    );
  }

  // Self-hosted
  return (
    <div className="alert alert-info">
      Purchase a commercial license key to encrypt the response from this SDK
      endpoint. Contact{" "}
      <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for more
      info.
    </div>
  );
}
