import { ReactNode } from "react";
import { FC, HTMLAttributes } from "react";
import { MdInfoOutline } from "react-icons/md";

// todo: add support for variable positioning instead of just bottom.

interface Props extends HTMLAttributes<HTMLDivElement> {
  body: string | JSX.Element;
  tipMinWidth?: string;
  tipTriggerPosition?: "position-fixed";
  tipPosition?: "bottom" | "top" | "left" | "right";
  innerClassName?: string;
  children?: ReactNode;
  textColor?: string;
  bgColor?: string;
  theme?: "white";
}
const Tooltip: FC<Props> = ({
  body,
  children,
  className,
  tipTriggerPosition = "position-relative",
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName,
  textColor = "white",
  bgColor = "#029dd1",
  theme,
  ...otherProps
}) => {
  if (!children) children = <MdInfoOutline style={{ color: "#029dd1" }} />;
  return (
    <>
      <div
        className={`tiptrigger ${className} ${tipTriggerPosition}`}
        {...otherProps}
      >
        {children}
        <div
          className={`tooltip bs-tooltip-${tipPosition} ${theme}`}
          role="tooltip"
        >
          <div className="arrow" />
          <div
            className={`tooltip-inner ${innerClassName}`}
            style={{
              minWidth: tipMinWidth ? tipMinWidth : null,
              backgroundColor: bgColor,
              color: textColor,
            }}
          >
            {body}
          </div>
        </div>
      </div>
    </>
  );
};
export default Tooltip;
