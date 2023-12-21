import { CommercialFeature } from "enterprise";
import { CSSProperties, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import Tooltip from "../Tooltip/Tooltip";
import { GBPremiumBadge } from "../Icons";

interface Props extends HTMLAttributes<HTMLDivElement> {
  commercialFeature: CommercialFeature;
  children: ReactNode;
  body?: string | JSX.Element;
  premiumText?: string | JSX.Element;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
  innerClassName?: string;
  popperStyle?: CSSProperties;
}

export default function PremiumTooltip({
  commercialFeature,
  children,
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string | El... Remove this comment to see the full error message
  body = null,
  premiumText = "This is a premium feature",
  tipMinWidth,
  tipPosition = "top",
  className = "",
  innerClassName = "",
  popperStyle,
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
                !hasFeature ? "premium" : ""
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
