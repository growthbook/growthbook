import { CommercialFeature } from "shared/enterprise";
import { Flex, IconButton, Callout as RadixCallout } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useState } from "react";
import { PiArrowSquareOut, PiLightbulb } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { DocLink, DocSection } from "@/components/DocLink";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import styles from "./RadixOverrides.module.scss";

export type Props = {
  commercialFeature: CommercialFeature;
  id: string;
  dismissable?: boolean;
  children: React.ReactNode;
  docSection?: DocSection;
} & MarginProps;

export default function PremiumCallout({
  commercialFeature,
  id,
  dismissable = false,
  children,
  docSection,
  ...containerProps
}: Props) {
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = hasCommercialFeature(commercialFeature);

  const [dismissed, setDismissed] = useLocalStorage(
    `premium-callout-${id}`,
    false
  );

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (hasFeature && !docSection) return null;
  if (dismissed) return null;

  const lowestPlanLevel =
    commercialFeatureLowestPlan?.[commercialFeature] || "";

  const enterprise = lowestPlanLevel === "enterprise";
  const pro = lowestPlanLevel === "pro";

  // Some unknown plan, skip showing the callout
  if (!enterprise && !pro) {
    return null;
  }

  if (upgradeModal) {
    return (
      <UpgradeModal
        commercialFeature={commercialFeature}
        close={() => setUpgradeModal(false)}
        source={`premium-callout-${id}`}
      />
    );
  }

  const color = hasFeature ? "violet" : pro ? "gold" : "indigo";
  const icon = hasFeature ? (
    <PiLightbulb size={15} />
  ) : (
    <PaidFeatureBadge commercialFeature={commercialFeature} useTip={false} />
  );

  const link =
    hasFeature && docSection ? (
      <DocLink docSection={docSection}>
        View docs <PiArrowSquareOut size={15} />
      </DocLink>
    ) : pro ? (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setUpgradeModal(true);
        }}
      >
        Upgrade Now
      </a>
    ) : (
      <a href="https://www.growthbook.io/demo" target="_blank" rel="noreferrer">
        Talk to Sales <PiArrowSquareOut size={15} />
      </a>
    );

  return (
    <RadixCallout.Root
      className={styles.callout}
      color={color}
      role="alert"
      size="2"
      {...containerProps}
    >
      <RadixCallout.Icon>{icon}</RadixCallout.Icon>
      <RadixCallout.Text size="2">
        <Flex align="center" gap="1">
          <div>{children}</div>
          <div>{link}</div>
          {dismissable ? (
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              ml="auto"
            >
              x
            </IconButton>
          ) : null}
        </Flex>
      </RadixCallout.Text>
    </RadixCallout.Root>
  );
}
