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
  textColor?: string;
  bgColor?: string;
}
const Tooltip: FC<Props> = ({
  body,
  children,
  className,
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName,
  textColor = "white",
  bgColor = "dodgerBlue",
  ...otherProps
}) => {
  if (!children) children = <MdInfoOutline style={{ color: "#029dd1" }} />;
  return (
    <>
      <div className={`tiptrigger ${className}`} {...otherProps}>
        {children}
        <div className={`tooltip bs-tooltip-${tipPosition}`} role="tooltip">
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
