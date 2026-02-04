import { CommercialFeature } from "shared/enterprise";
import { Flex, IconButton, Callout as RadixCallout } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useState } from "react";
import { PiArrowSquareOut, PiLightbulb, PiX } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { DocLink, DocSection } from "@/components/DocLink";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Link from "@/ui/Link";
import styles from "./Callout.module.scss";

export type Props = {
  commercialFeature: CommercialFeature;
  id: string;
  dismissable?: boolean;
  renderWhenDismissed?: (undismiss: () => void) => React.ReactElement;
  children: React.ReactNode;
  docSection?: DocSection;
} & MarginProps;

export default function PremiumCallout({
  commercialFeature,
  id,
  dismissable = false,
  children,
  docSection,
  renderWhenDismissed,
  ...containerProps
}: Props) {
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = hasCommercialFeature(commercialFeature);

  const [dismissed, setDismissed] = useLocalStorage(
    `premium-callout:${id}`,
    false,
  );

  const [upgradeModal, setUpgradeModal] = useState(false);

  if (hasFeature && !docSection) return null;
  if (dismissable && dismissed)
    return renderWhenDismissed
      ? renderWhenDismissed(() => setDismissed(false))
      : null;

  const lowestPlanLevel =
    commercialFeatureLowestPlan?.[commercialFeature] || "";

  const enterprise = lowestPlanLevel === "enterprise";
  const pro = lowestPlanLevel === "pro";

  // Some unknown plan, skip showing the callout
  if (!enterprise && !pro) {
    return null;
  }

  const color = hasFeature ? "violet" : pro ? "gold" : "indigo";
  const icon = hasFeature ? (
    <PiLightbulb size={15} />
  ) : (
    <PaidFeatureBadge commercialFeature={commercialFeature} useTip={false} />
  );

  const link =
    hasFeature && docSection ? (
      <DocLink docSection={docSection} useRadix={true}>
        View docs <PiArrowSquareOut size={15} />
      </DocLink>
    ) : pro ? (
      <Link
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setUpgradeModal(true);
        }}
      >
        Upgrade Now
      </Link>
    ) : (
      <Link
        href="https://www.growthbook.io/demo"
        target="_blank"
        rel="noreferrer"
        style={{ whiteSpace: "nowrap" }}
      >
        Talk to Sales <PiArrowSquareOut size={15} />
      </Link>
    );

  return (
    <>
      {upgradeModal ? (
        <UpgradeModal
          commercialFeature={commercialFeature}
          close={() => setUpgradeModal(false)}
          source={`premium-callout-${id}`}
        />
      ) : null}
      <RadixCallout.Root
        className={styles.callout}
        color={color}
        role="alert"
        size="2"
        {...containerProps}
        style={{
          position: "relative",
        }}
      >
        <RadixCallout.Icon>{icon}</RadixCallout.Icon>
        <RadixCallout.Text size="2">
          <Flex align="start" gap="1" pr="3">
            <div>{children}</div>
            <div style={{ flex: 1 }}>{link}</div>
          </Flex>
        </RadixCallout.Text>
        {dismissable ? (
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              marginTop: -11,
            }}
          >
            <PiX />
          </IconButton>
        ) : null}
      </RadixCallout.Root>
    </>
  );
}
