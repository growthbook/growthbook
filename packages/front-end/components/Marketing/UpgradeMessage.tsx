import { CommercialFeature } from "shared/enterprise";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "@/components/Icons";
import styles from "./UpgradeMessage.module.scss";

export default function UpgradeMessage({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
  className,
  isEnterprise,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage?: string;
  className?: string;
  isEnterprise?: boolean;
}) {
  if (!upgradeMessage) {
    upgradeMessage = "use this feature";
  }
  const { hasCommercialFeature } = useUser();
  if (hasCommercialFeature(commercialFeature)) return null;
  if (process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS) return null;

  const headerMessage = isCloud() ? (
    <>Upgrade your plan to {upgradeMessage}</>
  ) : isEnterprise ? (
    <>Try out Enterprise for free to {upgradeMessage}</>
  ) : (
    <>Get a license to {upgradeMessage}.</>
  );

  return (
    <a
      className={clsx(`${styles.ctaLink} cta mb-2`, className)}
      href="#"
      onClick={(e) => {
        e.preventDefault();
        showUpgradeModal();
      }}
    >
      <div className={`${styles.cta} alert alert-premium mb-0`}>
        <div className={`${styles.headerMessage} text-dark mb-2`}>
          {headerMessage}
        </div>
        <div
          className="btn btn-md btn-premium btn-light"
          style={{ minWidth: 145 }}
        >
          Learn more <GBPremiumBadge />
        </div>
      </div>
    </a>
  );
}
