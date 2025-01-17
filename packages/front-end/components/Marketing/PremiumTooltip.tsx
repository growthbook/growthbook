import { CommercialFeature } from "enterprise";
import { CSSProperties, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBPremiumBadge } from "@/components/Icons";
import { planNameFromAccountPlan } from "@/services/utils";

interface Props extends HTMLAttributes<HTMLDivElement> {
  commercialFeature?: CommercialFeature;
  children: ReactNode;
  body?: string | JSX.Element | null;
  premiumText?: string | JSX.Element;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
  innerClassName?: string;
  popperStyle?: CSSProperties;
  usePortal?: boolean;
}

export default function PremiumTooltip({
  commercialFeature,
  children,
  body = null,
  premiumText,
  tipMinWidth,
  tipPosition = "top",
  className = "",
  innerClassName = "",
  popperStyle,
  usePortal,
  ...otherProps
}: Props) {
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  const lowestPlanLevel = commercialFeature
    ? commercialFeatureLowestPlan?.[commercialFeature]
    : undefined;
  const planLevelText = `${
    lowestPlanLevel === "enterprise" ? "an" : "a"
  } ${planNameFromAccountPlan(lowestPlanLevel)}`;

  const tooltipText = premiumText ?? `This is ${planLevelText} feature`;

  return (
    <Tooltip
      shouldDisplay={!!body || !hasFeature}
      body={
        <>
          {!hasFeature && (
            <p
              className={clsx(
                body ? "mb-2" : "mb-0",
                !hasFeature ? "premium" : ""
              )}
            >
              <GBPremiumBadge className="mr-1" />
              {tooltipText}
            </p>
          )}
          {body}
        </>
      }
      tipMinWidth={tipMinWidth}
      tipPosition={tipPosition}
      className={className || ""}
      innerClassName={innerClassName || ""}
      popperStyle={popperStyle}
      usePortal={usePortal}
      // do not fire track event they have the feature
      trackingEventTooltipType={hasFeature ? undefined : "premium-tooltip"}
      trackingEventTooltipSource={commercialFeature}
      {...otherProps}
    >
      <div className="d-flex align-items-center">
        {!hasFeature && (
          <GBPremiumBadge
            className="text-premium"
            shouldDisplay={!hasFeature}
            prependsText={true}
          />
        )}
        {children}
      </div>
    </Tooltip>
  );
}
