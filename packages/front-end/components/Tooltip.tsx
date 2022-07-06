import { ReactNode } from "react";
import { FC, HTMLAttributes } from "react";
import { MdInfoOutline } from "react-icons/md";

// todo: add support for variable positioning instead of just bottom.

interface Props extends HTMLAttributes<HTMLDivElement> {
  body: string | JSX.Element;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  innerClassName?: string;
  children?: ReactNode;
  theme?: "white";
}
const Tooltip: FC<Props> = ({
  body,
  children,
  className,
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName,
  theme = "blue",
  ...otherProps
}) => {
  let bgColor: string | null = null;
  let textColor: string | null = null;
  if (theme === "white") {
    bgColor = "white";
    textColor = "black";
  }

  if (!children) children = <MdInfoOutline style={{ color: "#029dd1" }} />;
  return (
    <>
      <div className={`tiptrigger ${className}`} {...otherProps}>
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
