import { useUser } from "../services/UserContext";
import { isCloud } from "../services/env";
import useStripeSubscription from "../hooks/useStripeSubscription";
import { CommercialFeature } from "back-end/types/organization";
import Link from "next/link";

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
  const { hasCommercialFeature } = useUser();

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
    <div className="alert alert-info">
      <p>Purchase a commercial license key to {upgradeMessage}.{" "}
        Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for more info.</p>
      <p className="mb-0">Or try a commercial license for free by clicking <Link href={`/settings/try-pro/`}>here</Link></p>
    </div>
  );
}
