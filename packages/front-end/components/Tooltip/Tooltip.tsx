import {
  ReactNode,
  FC,
  HTMLAttributes,
  useState,
  useEffect,
  CSSProperties,
  useRef,
  useCallback,
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
  ignoreMouseEvents?: boolean; // Prevent the tooltip from reacting to mouseEnter and mouseExit events
  // must be set for tracking event to fire on hover
  trackingEventTooltipType?: string;
  trackingEventTooltipSource?: string;
  delay?: number; // Delay in milliseconds before showing the tooltip
  flipTheme?: boolean;
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
  ignoreMouseEvents = false,
  trackingEventTooltipType,
  trackingEventTooltipSource,
  delay = 300,
  flipTheme = true,
  ...otherProps
}) => {
  const [open, setOpen] = useState(state ?? false);
  const [fadeIn, setFadeIn] = useState(false);
  const [alreadyHovered, setAlreadyHovered] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [timeoutRef]);

  const handleMouseEnter = useCallback(() => {
    clearTimeouts();
    timeoutRef.current = setTimeout(() => {
      setOpen(true);
      setTimeout(() => setFadeIn(true), 50);
    }, delay);
  }, [clearTimeouts, timeoutRef, setOpen, setFadeIn, delay]);

  const handleMouseLeave = useCallback(() => {
    clearTimeouts();
    timeoutRef.current = setTimeout(() => {
      setFadeIn(false);
      setTimeout(() => setOpen(false), 300);
    }, 200);
  }, [clearTimeouts]);

  useEffect(() => {
    // Bypasses the normal mouse event triggers for direct state control
    if (state === true) {
      handleMouseEnter();
    } else if (state === false) {
      handleMouseLeave();
    }
  }, [state, handleMouseEnter, handleMouseLeave]);

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

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(
    triggerRef.current,
    tooltipRef.current,
    {
      modifiers: [
        { name: "arrow", options: { element: arrowRef.current } },
        { name: "offset", options: { offset: [0, 10] } },
      ],
      placement: tipPosition,
      strategy: "fixed",
    },
  );

  if (!children && children !== 0) children = <GBInfo />;
  const el = (
    <span
      ref={triggerRef}
      onMouseEnter={ignoreMouseEvents ? undefined : handleMouseEnter}
      onMouseLeave={ignoreMouseEvents ? undefined : handleMouseLeave}
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
          <RadixTheme flip={flipTheme}>
            <Box
              ref={tooltipRef}
              onMouseEnter={ignoreMouseEvents ? undefined : handleMouseEnter}
              onMouseLeave={ignoreMouseEvents ? undefined : handleMouseLeave}
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
                popperClassName,
              )}
              role="tooltip"
            >
              <div className={`body ${innerClassName}`}>{body}</div>
              <div ref={arrowRef} style={styles.arrow} className="arrow" />
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
