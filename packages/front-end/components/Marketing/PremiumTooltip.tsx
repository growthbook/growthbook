import { CommercialFeature } from "shared/enterprise";
import { CSSProperties, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { Flex, Text } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBPremiumBadge } from "@/components/Icons";
import { planNameFromAccountPlan } from "@/services/utils";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

interface Props extends HTMLAttributes<HTMLDivElement> {
  commercialFeature?: CommercialFeature;
  children?: ReactNode;
  body?: string | React.ReactNode | null;
  premiumText?: string | React.ReactNode;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
  innerClassName?: string;
  popperStyle?: CSSProperties;
  usePortal?: boolean;
  oldStyle?: boolean;
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
  oldStyle = false,
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

  // hopefully we can remove this oldStyle check soon
  if (oldStyle) {
    return (
      <Tooltip
        shouldDisplay={!!body || !hasFeature}
        body={
          <>
            {!hasFeature && (
              <p
                className={clsx(
                  body ? "mb-2" : "mb-0",
                  !hasFeature ? "premium" : "",
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
  return (
    <Tooltip
      shouldDisplay={!!body || !hasFeature}
      body={
        <>
          {!hasFeature && (
            <Text
              as="p"
              mb={body ? "2" : "0"}
              className={clsx(!hasFeature ? "font-weight-bold" : "")}
            >
              {tooltipText}
            </Text>
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
      <Flex gap="2" align="center" justify="start">
        {children}{" "}
        {!hasFeature && (
          <PaidFeatureBadge
            commercialFeature={commercialFeature}
            premiumText={tooltipText}
            useTip={false}
            mx="2"
          />
        )}
      </Flex>
    </Tooltip>
  );
}
