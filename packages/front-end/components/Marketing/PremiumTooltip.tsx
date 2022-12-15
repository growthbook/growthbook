import { CommercialFeature } from "back-end/types/organization";
import { ReactNode } from "react";
import clsx from "clsx";
import { useUser } from "../../services/UserContext";
import Tooltip from "../Tooltip/Tooltip";
import { GBPremiumBadge } from "../Icons";

export default function PremiumTooltip({
  commercialFeature,
  children,
  body = null,
  tipPosition = "top",
  innerClassName = "",
}: {
  commercialFeature: CommercialFeature;
  children: ReactNode;
  body?: string | JSX.Element;
  tipPosition?: "bottom" | "top" | "left" | "right";
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
