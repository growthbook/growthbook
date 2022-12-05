import { useUser } from "../services/UserContext";
import { isCloud } from "../services/env";
import useStripeSubscription from "../hooks/useStripeSubscription";
import { CommercialFeature } from "back-end/types/organization";

export default function UpgradeMessage({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage: string;
}) {
  const { canSubscribe } = useStripeSubscription();
  const { hasCommercialFeature, accountPlan } = useUser();

  if (hasCommercialFeature(commercialFeature)) return null;

  if (isCloud()) {
    return (
      <div className="alert alert-info">
        Upgrade your plan to {upgradeMessage}.{" "}
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
    <a
      className="boxlink cta mb-3"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        showUpgradeModal();
      }}
    >
      <div className="alert alert-info m-0">
        <p className="mb-0">
          Upgrade to a commercial license key to {upgradeMessage}.
        </p>
        {accountPlan === "oss" && (
          <p className="mt-1 mb-0">
            Self hosted accounts: Try Enterprise for 3 months free!
          </p>
        )}
      </div>
    </a>
  );
}
