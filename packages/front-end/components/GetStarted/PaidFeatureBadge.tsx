import { CommercialFeature } from "shared/enterprise";
import React from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";
import { RadixColor } from "@/components/Radix/HelperText";
import Badge from "@/components/Radix/Badge";

const PaidFeatureBadge = ({
  commercialFeature,
  premiumText,
  useTip = true,
  marginLeft = "2",
}: {
  commercialFeature?: CommercialFeature;
  premiumText?: string | JSX.Element;
  useTip?: boolean;
  marginLeft?: string;
}) => {
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
      ml={marginLeft}
      mr="2"
      style={{
        cursor: "default",
      }}
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
