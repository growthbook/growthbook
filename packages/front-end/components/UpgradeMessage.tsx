import { useUser } from "../services/UserContext";
import { isCloud } from "../services/env";
import useStripeSubscription from "../hooks/useStripeSubscription";
import { CommercialFeature } from "back-end/types/organization";
import Link from "next/link";

export default function UpgradeMessage({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
  href,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage: string;
  href?: string;
}) {
  if (!href) {
    href = "/settings/try-pro";
  }
  const { canSubscribe } = useStripeSubscription();
  const { hasCommercialFeature } = useUser();

  if (hasCommercialFeature(commercialFeature)) return null;

  if (isCloud()) {
    return (
      <Link href={href}>
        <div className="alert alert-premium cta">
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
              Contact{" "}
              <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for
              more info.
            </>
          )}
        </div>
      </Link>
    );
  }

  // Self-hosted
  return (
    <Link href={href}>
      <div className="alert alert-premium cta">
        Purchase a commercial license key to {upgradeMessage}. Contact{" "}
        <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for more
        info.
      </div>
    </Link>
  );
}
