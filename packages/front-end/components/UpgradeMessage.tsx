import { useUser } from "../services/UserContext";
import { isCloud } from "../services/env";
import { CommercialFeature } from "back-end/types/organization";
import { GBPremiumBadge } from "./Icons";

export default function UpgradeMessage({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage?: string;
}) {
  if (!upgradeMessage) {
    upgradeMessage = "use this feature";
  }
  const { hasCommercialFeature } = useUser();
  if (hasCommercialFeature(commercialFeature)) return null;
  if (process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS) return null;

  const headerMessage = isCloud() ? (
    <>Upgrade your plan to {upgradeMessage}</>
  ) : (
    <>Purchase a commercial license to {upgradeMessage}.</>
  );

  return (
    <a
      className="cta-link cta mb-3"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        showUpgradeModal();
      }}
    >
      <div className="alert alert-premium cta">
        <h4 className="text-premium">{headerMessage}</h4>
        <div className="btn btn-md btn-premium" style={{ minWidth: 145 }}>
          Learn more <GBPremiumBadge />
        </div>
      </div>
    </a>
  );
}
