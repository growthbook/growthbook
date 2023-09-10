import { CommercialFeature } from "enterprise";
import { ReactNode } from "react";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import Tooltip from "../Tooltip/Tooltip";
import { GBPremiumBadge } from "../Icons";

export default function PremiumTooltip({
  commercialFeature,
  children,
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string | El... Remove this comment to see the full error message
  body = null,
  tipPosition = "top",
  className = "",
  innerClassName = "",
}: {
  commercialFeature: CommercialFeature;
  children: ReactNode;
  body?: string | JSX.Element;
  tipPosition?: "bottom" | "top" | "left" | "right";
  className?: string;
  innerClassName?: string;
}) {
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
              <GBPremiumBadge /> This is a premium feature
            </p>
          )}
          {body}
        </>
      }
      tipPosition={tipPosition}
      className={className || ""}
      innerClassName={innerClassName || ""}
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
