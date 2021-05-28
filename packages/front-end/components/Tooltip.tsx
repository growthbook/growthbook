import { FC, HTMLAttributes } from "react";
import { MdInfoOutline } from "react-icons/md";

// todo: add support for variable positioning instead of just bottom.

interface Props extends HTMLAttributes<HTMLDivElement> {
  text: string;
  tipMinWidth?: string;
}
const Tooltip: FC<Props> = ({
  text,
  children,
  className,
  tipMinWidth = "140px",
  ...otherProps
}) => {
  if (!children) children = <MdInfoOutline style={{ color: "#029dd1" }} />;
  return (
    <>
      <div className={`tiptrigger ${className}`} {...otherProps}>
        {children}
        <div className="tooltip bs-tooltip-bottom" role="tooltip">
          <div className="arrow"></div>
          <div
            className="tooltip-inner"
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
