import { CommercialFeature } from "enterprise";
import { CSSProperties, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBPremiumBadge } from "@/components/Icons";

interface Props extends HTMLAttributes<HTMLDivElement> {
  commercialFeature: CommercialFeature;
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
  premiumText = "This is a premium feature",
  tipMinWidth,
  tipPosition = "top",
  className = "",
  innerClassName = "",
  popperStyle,
  usePortal,
  ...otherProps
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature(commercialFeature);

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
              {premiumText}
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
      {...otherProps}
    >
      {!hasFeature && (
        <GBPremiumBadge
          className="text-premium"
          shouldDisplay={!hasFeature}
          prependsText={true}
        />
      )}
      {children}
    </Tooltip>
  );
}
