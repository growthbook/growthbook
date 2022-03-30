import { FC, HTMLAttributes } from "react";
import { MdInfoOutline } from "react-icons/md";

// todo: add support for variable positioning instead of just bottom.

interface Props extends HTMLAttributes<HTMLDivElement> {
  text: string;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  innerClassName?: string;
}
const Tooltip: FC<Props> = ({
  text,
  children,
  className,
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName = "",
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
            style={tipMinWidth ? { minWidth: tipMinWidth } : {}}
          >
            {text}
          </div>
        </div>
      </div>
    </>
  );
};
export default Tooltip;
