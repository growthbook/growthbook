import { CommercialFeature } from "shared/enterprise";
import React from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useLingui } from "@lingui/react/macro";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import { RadixColor } from "@/ui/HelperText";
import Badge from "@/ui/Badge";

export type Props = {
  commercialFeature?: CommercialFeature;
  premiumText?: string | JSX.Element;
  useTip?: boolean;
  variant?: "outline" | "solid";
  inheritColor?: boolean;
  showWhenEnabled?: boolean;
} & MarginProps;

const PaidFeatureBadge = ({
  commercialFeature,
  premiumText,
  useTip = true,
  variant = "outline",
  inheritColor = false,
  showWhenEnabled = false,
  ...badgeProps
}: Props) => {
  const { t } = useLingui();
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  if (hasFeature && !showWhenEnabled) {
    return null;
  }

  const lowestPlanLevel = commercialFeature
    ? commercialFeatureLowestPlan?.[commercialFeature]
    : undefined;
  const planName = planNameFromAccountPlan(lowestPlanLevel);

  const tooltipText =
    premiumText ??
    (lowestPlanLevel === "enterprise"
      ? t`This is an ${planName} feature`
      : t`This is a ${planName} feature`);
  const badgeColor =
    lowestPlanLevel === "pro" || lowestPlanLevel === "pro_sso"
      ? "gold"
      : "indigo";

  const badge = (
    <Badge
      label={
        lowestPlanLevel === "pro"
          ? "Pro"
          : lowestPlanLevel === "enterprise"
            ? "Enterprise"
            : t`Paid`
      }
      color={badgeColor as RadixColor}
      variant={variant}
      radius="full"
      style={{
        cursor: "default",
        ...(inheritColor && {
          color: "currentColor",
          boxShadow: "inset 0 0 0 1px currentColor",
        }),
      }}
      {...badgeProps}
    />
  );

  if (!useTip) {
    return badge;
  }

  return (
    <Tooltip body={tooltipText} tipPosition="top">
      {badge}
    </Tooltip>
  );
};

export default PaidFeatureBadge;
