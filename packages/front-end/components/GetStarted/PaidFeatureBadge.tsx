import { CommercialFeature } from "enterprise";
import { gold, indigo } from "@radix-ui/colors";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { planNameFromAccountPlan } from "@/services/utils";

const PaidFeatureBadge = ({
  commercialFeature,
  premiumText,
}: {
  commercialFeature?: CommercialFeature;
  premiumText?: string;
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

  return (
    <Tooltip body={tooltipText} tipPosition="top">
      <span
        className="badge ml-2"
        style={{
          backgroundColor:
            lowestPlanLevel === "pro" || lowestPlanLevel === "pro_sso"
              ? gold.gold9
              : indigo.indigo9,
          color: "#FFFFFF",
        }}
      >
        PAID
      </span>
    </Tooltip>
  );
};

export default PaidFeatureBadge;
