import { CommercialFeature } from "@/../back-end/types/organization";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";

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

  const showUpgradeCTA =
    !hasCommercialFeature(commercialFeature) ||
    !process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS;

  const headerMessage = isCloud()
    ? `Please upgrade your plan to ${upgradeMessage}.`
    : `Please purchase a commercial license to ${upgradeMessage}.`;

  return (
    <div>
      <label htmlFor="schedule-feature-flag">
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
          className="btn btn-sm btn-outline-primary ml-4 px-2"
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
