import { CommercialFeature } from "enterprise";
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
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  upgradeMessage?: string;
  className?: string;
}) {
  if (!upgradeMessage) {
    upgradeMessage = "use this feature";
  }
  const { hasCommercialFeature } = useUser();
  if (hasCommercialFeature(commercialFeature)) return null;
  if (process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS) return null;

  // 仅在云环境下展示升级提示
  if (!isCloud()) return null;

  const headerMessage = (
    <>Upgrade your plan to {upgradeMessage}</>
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
        {/* <div className="btn btn-md btn-premium" style={{ minWidth: 145 }}>
          Learn more <GBPremiumBadge />
        </div> */}
      </div>
    </a>
  );
}