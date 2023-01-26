import { CommercialFeature } from "back-end/types/organization";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import Tooltip from "../Tooltip/Tooltip";
import { GBPremiumBadge } from "../Icons";

export default function UpgradeLabel({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
  labelText,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage?: string;
  labelText: string;
}) {
  if (!upgradeMessage) {
    upgradeMessage = "use this feature";
  }

  const { hasCommercialFeature } = useUser();

  // Only show if they don't have the feature and they don't have the env variable to hide it
  const showUpgradeCTA =
    !hasCommercialFeature(commercialFeature) &&
    !process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS;

  const headerMessage = isCloud()
    ? `Please upgrade your plan to ${upgradeMessage}.`
    : `Please purchase a commercial license to ${upgradeMessage}.`;

  return (
    <div className="row align-items-center">
      <label className="col-auto" htmlFor="schedule-feature-flag">
        {showUpgradeCTA ? (
          <Tooltip
            body={`This is a premium feature. ${headerMessage}`}
            tipPosition="top"
          >
            {labelText}
          </Tooltip>
        ) : (
          labelText
        )}
      </label>
      {showUpgradeCTA && (
        <a
          href="#"
          className="btn btn-sm btn-outline-primary ml-2 px-2 mb-2 col-auto"
          style={{ paddingTop: "2px", paddingBottom: "2px" }}
          onClick={(e) => {
            e.preventDefault();
            showUpgradeModal();
          }}
        >
          <GBPremiumBadge size="small" />
          <span className="pl-1">Upgrade Plan</span>
        </a>
      )}
    </div>
  );
}
