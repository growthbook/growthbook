import { CommercialFeature } from "shared/enterprise";
import clsx from "clsx";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "@/components/Icons";
import styles from "./UpgradeMessage.module.scss";

// The header for each way to get the feature, each a whole sentence.
export type UpgradeHeaders = {
  cloud: MessageDescriptor;
  enterprise: MessageDescriptor;
  license: MessageDescriptor;
};

const USE_THIS_FEATURE: UpgradeHeaders = {
  cloud: msg`Upgrade your plan to use this feature`,
  enterprise: msg`Try out Enterprise for free to use this feature`,
  license: msg`Get a license to use this feature.`,
};

export const OVERRIDE_METRICS_UPGRADE: UpgradeHeaders = {
  cloud: msg`Upgrade your plan to override metrics`,
  enterprise: msg`Try out Enterprise for free to override metrics`,
  license: msg`Get a license to override metrics.`,
};

export default function UpgradeMessage({
  showUpgradeModal,
  commercialFeature,
  upgradeMessage,
  className,
  isEnterprise,
}: {
  showUpgradeModal: () => void;
  commercialFeature: CommercialFeature;
  // A phrase finishing the English header, for callers not translated yet.
  upgradeMessage?: string | UpgradeHeaders;
  className?: string;
  isEnterprise?: boolean;
}) {
  const { i18n } = useLingui();
  const { hasCommercialFeature } = useUser();
  if (hasCommercialFeature(commercialFeature)) return null;
  if (process.env.HIDE_GROWTHBOOK_UPGRADE_CTAS) return null;

  const headers = upgradeMessage || USE_THIS_FEATURE;
  const headerMessage =
    typeof headers === "string" ? (
      isCloud() ? (
        <>Upgrade your plan to {headers}</>
      ) : isEnterprise ? (
        <>Try out Enterprise for free to {headers}</>
      ) : (
        <>Get a license to {headers}.</>
      )
    ) : (
      i18n._(
        isCloud()
          ? headers.cloud
          : isEnterprise
            ? headers.enterprise
            : headers.license,
      )
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
          <Trans>Learn more</Trans> <GBPremiumBadge />
        </div>
      </div>
    </a>
  );
}
