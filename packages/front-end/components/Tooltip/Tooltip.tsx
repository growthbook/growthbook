import {
  ReactNode,
  FC,
  HTMLAttributes,
  useState,
  useEffect,
  CSSProperties,
} from "react";
import { MdInfoOutline } from "react-icons/md";
import { usePopper } from "react-popper";
import clsx from "clsx";
import Portal from "@/components/Modal/Portal";

interface Props extends HTMLAttributes<HTMLDivElement> {
  body: string | JSX.Element;
  popperClassName?: string;
  popperStyle?: CSSProperties;
  tipMinWidth?: string;
  tipPosition?: "bottom" | "top" | "left" | "right";
  innerClassName?: string;
  children?: ReactNode;
  shouldDisplay?: boolean;
  usePortal?: boolean;
  state?: boolean;
}
const Tooltip: FC<Props> = ({
  body,
  children,
  className = "",
  popperClassName = "",
  popperStyle,
  tipMinWidth = "140px",
  tipPosition = "bottom",
  innerClassName = "",
  shouldDisplay = true,
  usePortal = false,
  state,
  ...otherProps
}) => {
  const [trigger, setTrigger] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [arrow, setArrow] = useState(null);
  const [open, setOpen] = useState(state ?? false);

  useEffect(() => {
    if (state !== undefined) {
      setOpen(state);
    }
  }, [state, setOpen]);

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
  const el = (
    <span
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<null>>' is not assig... Remove this comment to see the full error message
      ref={setTrigger}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onPointerLeave={() => setOpen(false)}
      className={`${className}`}
      {...otherProps}
    >
      {children}
    </span>
  );
  const popper = (
    <>
      {open && body && shouldDisplay && (
        <div
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<null>>' is not assig... Remove this comment to see the full error message
          ref={setTooltip}
          style={{
            ...styles.popper,
            minWidth: tipMinWidth,
            maxWidth: 400,
            zIndex: 10000,
            ...popperStyle,
          }}
          {...attributes.popper}
          className={clsx("shadow-lg gb-tooltip", popperClassName)}
          role="tooltip"
        >
          <div className={`body ${innerClassName}`}>{body}</div>
          {/* @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<null>>' is not assig... Remove this comment to see the full error message */}
          <div ref={setArrow} style={styles.arrow} className="arrow" />
        </div>
      )}
    </>
  );

  if (!usePortal) {
    return (
      <>
        {el}
        {popper}
      </>
    );
  } else {
    return (
      <>
        {el}
        <Portal>{popper}</Portal>
      </>
    );
  }
};
export default Tooltip;
