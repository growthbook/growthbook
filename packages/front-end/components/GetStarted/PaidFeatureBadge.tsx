import { CommercialFeature } from "shared/enterprise";
import React from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import { RadixColor } from "@/components/Radix/HelperText";
import Badge from "@/components/Radix/Badge";

export type Props = {
  commercialFeature?: CommercialFeature;
  premiumText?: string | JSX.Element;
  useTip?: boolean;
} & MarginProps;

const PaidFeatureBadge = ({
  commercialFeature,
  premiumText,
  useTip = true,
  ...badgeProps
}: Props) => {
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  if (hasFeature) {
    return null;
  }

  const lowestPlanLevel = commercialFeature
    ? commercialFeatureLowestPlan?.[commercialFeature]
    : undefined;
  const planLevelText = `${
    lowestPlanLevel === "enterprise" ? "an" : "a"
  } ${planNameFromAccountPlan(lowestPlanLevel)}`;

  const tooltipText = premiumText ?? `This is ${planLevelText} feature`;
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
          : "Paid"
      }
      color={badgeColor as RadixColor}
      variant="outline"
      radius="full"
      style={{
        cursor: "default",
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
