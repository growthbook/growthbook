import { FC, HTMLAttributes, useState } from "react";
import { MdInfoOutline } from "react-icons/md";
import { usePopper } from "react-popper";

interface Props extends HTMLAttributes<HTMLDivElement> {
  body: string | JSX.Element;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  innerClassName?: string;
  shouldDisplay?: boolean;
}
const Tooltip: FC<Props> = ({
  body,
  children,
  className = "",
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName = "",
  shouldDisplay = true,
  ...otherProps
}) => {
  const [trigger, setTrigger] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [arrow, setArrow] = useState(null);
  const [open, setOpen] = useState(false);

  const { styles, attributes } = usePopper(trigger, tooltip, {
    modifiers: [
      { name: "arrow", options: { element: arrow } },
      {
        name: "offset",
        options: {
          offset: [0, 10],
        },
      },
    ],
    placement: tipPosition,
    strategy: "fixed",
  });

  if (!children) children = <MdInfoOutline style={{ color: "#029dd1" }} />;
  return (
    <>
      <span
        ref={setTrigger}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`${className}`}
        {...otherProps}
      >
        {children}
      </span>
      {open && body && shouldDisplay && (
        <div
          ref={setTooltip}
          style={{
            ...styles.popper,
            minWidth: tipMinWidth,
            maxWidth: 400,
            zIndex: 10000,
          }}
          {...attributes.popper}
          className="shadow-lg gb-tooltip"
          role="tooltip"
        >
          <div className={`body ${innerClassName}`}>{body}</div>
          <div ref={setArrow} style={styles.arrow} className="arrow" />
        </div>
      )}
    </>
  );
};
export default Tooltip;
