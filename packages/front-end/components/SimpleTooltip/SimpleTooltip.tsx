import React, { FC, PropsWithChildren, useMemo } from "react";

type SimpleTooltipProps = PropsWithChildren<{
  position: "top" | "right" | "bottom" | "left";
}>;

export const SimpleTooltip: FC<SimpleTooltipProps> = ({
  children,
  position,
}) => {
  const tooltipStyle = useMemo(() => {
    switch (position) {
      case "top":
        return { top: "0%", transform: "translateY(-100%)" };
      case "right":
        return {
          left: "unset",
          top: "50%",
          right: "0",
          marginRight: "-1rem",
          transform: "translate(100%, -50%)",
        };
      case "bottom":
        return { top: "100%" };
      case "left":
        return {
          left: "0%",
          top: "50%",
          right: "unset",
          marginLeft: "-1rem",
          transform: "translate(-100%, -50%)",
        };
    }
  }, [position]);

  const arrowStyle = useMemo(() => {
    switch (position) {
      case "top":
        return {
          top: "unset",
          bottom: 0,
          left: "50%",
          marginLeft: "-0.4rem",
          transform: "rotate(180deg)",
        };
      case "right":
        return {
          left: "0",
          right: "unset",
          marginLeft: "-0.5rem",
          transform: "translateY(-50%) rotate(275deg)",
          top: "50%",
        };
      case "bottom":
        return { left: "50%", marginLeft: "-0.4rem" };
      case "left":
        return {
          left: "unset",
          right: "0",
          marginRight: "-0.5rem",
          transform: "translateY(-50%) rotate(90deg)",
          top: "50%",
        };
    }
  }, [position]);

  return (
    <div
      className="tooltip bs-tooltip-bottom show"
      role="tooltip"
      style={tooltipStyle}
    >
      <span className="arrow" style={arrowStyle} />
      <div className="tooltip-inner">{children}</div>
    </div>
  );
};
