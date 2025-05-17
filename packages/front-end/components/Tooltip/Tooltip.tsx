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
  delay?: number; // Delay in milliseconds before showing the tooltip
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
  delay = 300, // Default delay of 200ms
  ...otherProps
}) => {
  const [trigger, setTrigger] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [arrow, setArrow] = useState(null);
  const [open, setOpen] = useState(state ?? false);
  const [fadeIn, setFadeIn] = useState(false);
  const [alreadyHovered, setAlreadyHovered] = useState(false);
  // we have to split the open state from the fade in state as if we set it all at once,
  // the fade won't work as the opacity is not technically changing. By delaying slightly
  // when we set the opacity to 1 (`tooltip-visible`) it lets the CSS transition work.
  const openTimeout = useRef<NodeJS.Timeout | null>(null);
  const fadeInTimeout = useRef<NodeJS.Timeout | null>(null);
  const fadeOutTimeout = useRef<NodeJS.Timeout | null>(null);
  const closeTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (state !== undefined) {
      setOpen(state);
    }
  }, [state]);

  useEffect(() => {
    if (open && !alreadyHovered && trackingEventTooltipType) {
      setAlreadyHovered(true);
      track("tooltip-open", {
        type: trackingEventTooltipType,
        source: trackingEventTooltipSource,
      });
    }
  }, [
    open,
    alreadyHovered,
    trackingEventTooltipType,
    trackingEventTooltipSource,
  ]);

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
    if (fadeOutTimeout.current) {
      clearTimeout(fadeOutTimeout.current);
    }
    openTimeout.current = setTimeout(() => {
      setOpen(true);
      fadeInTimeout.current = setTimeout(() => setFadeIn(true), 50);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (openTimeout.current) {
      clearTimeout(openTimeout.current);
    }
    if (fadeInTimeout.current) {
      clearTimeout(fadeInTimeout.current);
    }
    closeTimeout.current = setTimeout(() => {
      setFadeIn(false);
      fadeOutTimeout.current = setTimeout(() => setOpen(false), 300);
    }, 200); // Optional: Keep a small delay for closing
  };

  if (!children && children !== 0) children = <GBInfo />;
  const el = (
    <span
      // @ts-expect-error TS(2322) If you come across this, please fix it!
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
              className={clsx(
                "shadow-lg gb-tooltip",
                fadeIn ? "tooltip-visible" : "tooltip-hidden",
                popperClassName
              )}
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
