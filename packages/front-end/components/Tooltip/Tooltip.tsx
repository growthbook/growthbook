import {
  ReactNode,
  FC,
  HTMLAttributes,
  useState,
  useEffect,
  CSSProperties,
  useRef,
} from "react";
import { usePopper } from "react-popper";
import clsx from "clsx";
import { Box } from "@radix-ui/themes";
import Portal from "@/components/Modal/Portal";
import track from "@/services/track";
import { RadixTheme } from "@/services/RadixTheme";
import { GBInfo } from "@/components/Icons";

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
  // must be set for tracking event to fire on hover
  trackingEventTooltipType?: string;
  trackingEventTooltipSource?: string;
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
  trackingEventTooltipType,
  trackingEventTooltipSource,
  ...otherProps
}) => {
  const [trigger, setTrigger] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [arrow, setArrow] = useState(null);
  const [open, setOpen] = useState(state ?? false);
  const [alreadyHovered, setAlreadyHovered] = useState(false);
  const closeTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (state !== undefined) {
      setOpen(state);
    }
  }, [state, setOpen]);

  useEffect(() => {
    if (open && !alreadyHovered && trackingEventTooltipType) {
      setAlreadyHovered(true);
      track("tooltip-open", {
        type: trackingEventTooltipType,
        source: trackingEventTooltipSource,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alreadyHovered, trackingEventTooltipType]);

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

  const handleMouseEnter = () => {
    if (closeTimeout.current) {
      clearTimeout(closeTimeout.current);
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeout.current = setTimeout(() => {
      setOpen(false);
    }, 200);
  };

  if (!children && children !== 0) children = <GBInfo />;
  const el = (
    <span
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<null>>' is not assig... Remove this comment to see the full error message
      ref={setTrigger}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${className}`}
      {...otherProps}
    >
      {children}
    </span>
  );

  const popper = (
    <>
      {open && body && shouldDisplay && (
        <Box style={{ position: "absolute" }}>
          <RadixTheme flip={true}>
            <Box
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<null>>' is not assig... Remove this comment to see the full error message
              ref={setTooltip}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
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
            </Box>
          </RadixTheme>
        </Box>
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
