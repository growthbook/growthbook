import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  type VirtualElement,
} from "@floating-ui/react";
import { RadixTheme } from "@/services/RadixTheme";
import styles from "./useHoverTooltip.module.scss";

interface HoverTooltipContextValue {
  openTooltip: (id: string) => boolean;
  closeTooltip: (id: string) => void;
}

const HoverTooltipContext = createContext<HoverTooltipContextValue>({
  openTooltip: () => false,
  closeTooltip: () => {},
});

export function HoverTooltipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use ref for synchronous state tracking
  const openTooltipIdRef = useRef<string | null>(null);

  const openTooltip = useCallback((id: string): boolean => {
    if (openTooltipIdRef.current !== null) {
      return false;
    }
    openTooltipIdRef.current = id;
    return true;
  }, []);

  const closeTooltip = useCallback((id: string): void => {
    if (openTooltipIdRef.current === id) {
      openTooltipIdRef.current = null;
    }
  }, []);

  const value = useMemo(
    () => ({ openTooltip, closeTooltip }),
    [openTooltip, closeTooltip],
  );

  return (
    <HoverTooltipContext.Provider value={value}>
      {children}
    </HoverTooltipContext.Provider>
  );
}

export function useHoverTooltipContext() {
  return useContext(HoverTooltipContext);
}

const HIDE_DELAY_MS = 50;
const VERTICAL_OFFSET_PX = 8;
type PositioningMode = "cursor" | "element";
type TooltipState = "idle" | "waiting" | "visible";

export interface UseHoverTooltipOptions {
  enabled?: boolean;
  delayMs?: number;
  positioning?: PositioningMode;
}

export interface UseHoverTooltipReturn {
  triggerProps: {
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
  };
  isVisible: boolean;
  close: () => void;
  renderTooltip: (content: React.ReactNode) => React.ReactElement | null;
}

interface Position {
  x: number;
  y: number;
}

export type { PositioningMode };

interface TooltipPortalProps {
  content: React.ReactNode;
  triggerElement: HTMLElement | null;
  cursorPosition: Position | null;
  positioning: PositioningMode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function TooltipPortal({
  content,
  triggerElement,
  cursorPosition,
  positioning,
  onMouseEnter,
  onMouseLeave,
}: TooltipPortalProps) {
  // Create a virtual element for cursor positioning
  const virtualElement = useMemo((): VirtualElement | null => {
    if (positioning !== "cursor" || !cursorPosition) return null;
    return {
      getBoundingClientRect: () => ({
        x: cursorPosition.x,
        y: cursorPosition.y,
        width: 0,
        height: 0,
        top: cursorPosition.y,
        left: cursorPosition.x,
        right: cursorPosition.x,
        bottom: cursorPosition.y,
      }),
    };
  }, [positioning, cursorPosition]);

  const { refs, floatingStyles, update, placement } = useFloating({
    placement: "top",
    middleware: [
      offset(VERTICAL_OFFSET_PX),
      flip({ fallbackPlacements: ["bottom", "top"] }),
      shift({ padding: VERTICAL_OFFSET_PX }),
    ],
  });

  // Set reference element based on positioning mode
  useLayoutEffect(() => {
    if (positioning === "element" && triggerElement) {
      refs.setReference(triggerElement);
    } else if (positioning === "cursor" && virtualElement) {
      refs.setPositionReference(virtualElement);
    }
  }, [positioning, triggerElement, virtualElement, refs]);

  // Auto-update position for element mode
  useEffect(() => {
    if (positioning === "element" && triggerElement && refs.floating.current) {
      return autoUpdate(triggerElement, refs.floating.current, update);
    }
  }, [positioning, triggerElement, refs.floating, update]);

  // CSS bridge for element mode - adjusts based on actual placement (top vs bottom)
  const isPlacedOnTop = placement.startsWith("top");
  const bridgeStyle: React.CSSProperties =
    positioning === "element"
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          // If tooltip is on top, bridge extends down from bottom
          // If tooltip is on bottom, bridge extends up from top
          ...(isPlacedOnTop
            ? { bottom: 0, transform: "translateY(100%)" }
            : { top: 0, transform: "translateY(-100%)" }),
          height: VERTICAL_OFFSET_PX + 4,
        }
      : {};

  const tooltipStyle: React.CSSProperties = {
    ...floatingStyles,
    zIndex: 9999,
  };

  // Prevent clicks from passing through to elements below the tooltip
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  if (positioning === "cursor") {
    return createPortal(
      <RadixTheme>
        <div
          ref={refs.setFloating}
          className={styles.tooltip}
          style={tooltipStyle}
          onClick={handleClick}
        >
          {content}
        </div>
      </RadixTheme>,
      document.body,
    );
  }

  return createPortal(
    <RadixTheme>
      <div
        ref={refs.setFloating}
        className={styles.tooltip}
        style={tooltipStyle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleClick}
      >
        {content}
        <div style={bridgeStyle} />
      </div>
    </RadixTheme>,
    document.body,
  );
}

export function useHoverTooltip({
  enabled = true,
  delayMs = 100,
  positioning = "element",
}: UseHoverTooltipOptions = {}): UseHoverTooltipReturn {
  const id = useId();
  const { openTooltip, closeTooltip } = useHoverTooltipContext();

  const [state, setState] = useState<TooltipState>("idle");
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(
    null,
  );
  const [cursorPosition, setCursorPosition] = useState<Position | null>(null);

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContentHoveredRef = useRef(false);
  const isTriggerHoveredRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Cleanup on unmount - release global lock if this tooltip is open
  useEffect(() => {
    return () => {
      closeTooltip(id);
    };
  }, [closeTooltip, id]);

  const close = useCallback(() => {
    clearTimers();
    setState("idle");
    closeTooltip(id);
    // Reset hover state to avoid stale refs when tooltip is closed programmatically
    isTriggerHoveredRef.current = false;
    isContentHoveredRef.current = false;
  }, [clearTimers, closeTooltip, id]);

  const isVisible = state === "visible";

  // Close on scroll
  useEffect(() => {
    if (!isVisible) return;

    const handleScroll = () => {
      close();
    };

    window.addEventListener("scroll", handleScroll, { capture: true });

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [isVisible, close]);

  const onMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;

      e.stopPropagation?.();

      isTriggerHoveredRef.current = true;
      clearTimers();

      // If already visible, just stay visible (cancel any pending hide)
      if (state === "visible") {
        return;
      }

      // Capture reference based on mode
      if (positioning === "element") {
        setTriggerElement(e.currentTarget as HTMLElement);
      } else {
        // Cursor mode: position at cursor
        setCursorPosition({
          x: e.clientX,
          y: e.clientY,
        });
      }

      setState("waiting");

      showTimerRef.current = setTimeout(() => {
        const success = openTooltip(id);
        if (success) {
          setState("visible");
        } else {
          setState("idle");
        }
      }, delayMs);
    },
    [enabled, positioning, state, delayMs, openTooltip, id, clearTimers],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;

      if (positioning === "cursor") {
        // Update position to cursor coordinates
        setCursorPosition({
          x: e.clientX,
          y: e.clientY,
        });

        // If visible, close immediately on any mouse movement
        if (state === "visible") {
          close();
          return;
        }

        // Reset the show timer - tooltip only appears after mouse is still
        if (state === "waiting") {
          if (showTimerRef.current) {
            clearTimeout(showTimerRef.current);
          }
          showTimerRef.current = setTimeout(() => {
            const success = openTooltip(id);
            if (success) {
              setState("visible");
            } else {
              setState("idle");
            }
          }, delayMs);
        }
      }
    },
    [enabled, positioning, state, delayMs, openTooltip, id, close],
  );

  const onMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;

      e.stopPropagation?.();

      isTriggerHoveredRef.current = false;

      if (state === "waiting") {
        // Cancel show timer if we're still waiting
        clearTimers();
        setState("idle");
        return;
      }

      if (state === "visible") {
        if (positioning === "cursor") {
          // Cursor mode: close immediately (no delay)
          close();
        } else {
          // Element mode: start hide timer
          hideTimerRef.current = setTimeout(() => {
            if (!isContentHoveredRef.current && !isTriggerHoveredRef.current) {
              close();
            }
          }, HIDE_DELAY_MS);
        }
      }
    },
    [enabled, state, positioning, clearTimers, close],
  );

  // Close tooltip when clicking on trigger (e.g., to open a modal)
  const onClick = useCallback(() => {
    if (state !== "idle") {
      close();
    }
  }, [state, close]);

  const triggerProps = useMemo(
    () => ({
      onMouseEnter,
      onMouseMove,
      onMouseLeave,
      onClick,
    }),
    [onMouseEnter, onMouseMove, onMouseLeave, onClick],
  );

  const handleContentMouseEnter = useCallback(() => {
    isContentHoveredRef.current = true;
    clearTimers();
  }, [clearTimers]);

  const handleContentMouseLeave = useCallback(() => {
    isContentHoveredRef.current = false;
    hideTimerRef.current = setTimeout(() => {
      // Only close if neither trigger nor content is hovered
      if (!isContentHoveredRef.current && !isTriggerHoveredRef.current) {
        close();
      }
    }, HIDE_DELAY_MS);
  }, [close]);

  const renderTooltip = useCallback(
    (content: React.ReactNode): React.ReactElement | null => {
      if (!enabled || state !== "visible" || typeof document === "undefined") {
        return null;
      }

      return (
        <TooltipPortal
          content={content}
          triggerElement={triggerElement}
          cursorPosition={cursorPosition}
          positioning={positioning}
          onMouseEnter={handleContentMouseEnter}
          onMouseLeave={handleContentMouseLeave}
        />
      );
    },
    [
      enabled,
      state,
      triggerElement,
      cursorPosition,
      positioning,
      handleContentMouseEnter,
      handleContentMouseLeave,
    ],
  );

  return {
    triggerProps,
    isVisible,
    close,
    renderTooltip,
  };
}

export interface HoverTooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  delayMs?: number;
  positioning?: PositioningMode;
  enabled?: boolean;
}

export function HoverTooltip({
  children,
  content,
  delayMs,
  positioning,
  enabled,
}: HoverTooltipProps) {
  const { triggerProps, renderTooltip } = useHoverTooltip({
    delayMs,
    positioning,
    enabled,
  });

  const child = React.Children.only(children) as React.ReactElement<
    React.HTMLAttributes<HTMLElement>
  >;

  const clonedChild = React.cloneElement(child, {
    ...triggerProps,
    onMouseEnter: (e: React.MouseEvent) => {
      triggerProps.onMouseEnter(e);
      child.props.onMouseEnter?.(e);
    },
    onMouseMove: (e: React.MouseEvent) => {
      triggerProps.onMouseMove(e);
      child.props.onMouseMove?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      triggerProps.onMouseLeave(e);
      child.props.onMouseLeave?.(e);
    },
    onClick: (e: React.MouseEvent) => {
      triggerProps.onClick(e);
      child.props.onClick?.(e);
    },
  });

  return (
    <>
      {clonedChild}
      {renderTooltip(content)}
    </>
  );
}
