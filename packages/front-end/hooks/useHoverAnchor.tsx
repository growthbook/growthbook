import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Tooltip from "@/ui/Tooltip";

interface HoverAnchorContextValue {
  isAnchorActive: boolean;
  setAnchorActive: (active: boolean) => void;
  /** Synchronous check for anchor activity (avoids React async state delays) */
  isAnchorActiveSync: () => boolean;
}

const HoverAnchorContext = createContext<HoverAnchorContextValue>({
  isAnchorActive: false,
  setAnchorActive: () => {},
  isAnchorActiveSync: () => false,
});

export function HoverAnchorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAnchorActive, setIsAnchorActive] = useState(false);
  // Ref for synchronous activity checks to prevent race conditions between anchors
  const anchorActiveRef = useRef(false);

  const setAnchorActive = useCallback(
    (active: boolean) => {
      anchorActiveRef.current = active;
      setIsAnchorActive(active);
    },
    [setIsAnchorActive],
  );

  const isAnchorActiveSync = useCallback(() => {
    return anchorActiveRef.current;
  }, []);

  const value = useMemo(
    () => ({
      isAnchorActive,
      setAnchorActive,
      isAnchorActiveSync,
    }),
    [isAnchorActive, setAnchorActive, isAnchorActiveSync],
  );

  return (
    <HoverAnchorContext.Provider value={value}>
      {children}
    </HoverAnchorContext.Provider>
  );
}

export function useHoverAnchorContext() {
  return useContext(HoverAnchorContext);
}

type PositioningMode = "cursor" | "element";

export interface UseHoverAnchorOptions {
  /**
   * Delay in milliseconds before showing the anchored content.
   * When set to 0 (default), content shows immediately.
   * When > 0, content shows after the cursor has been idle for this duration.
   * Note: Moving the cursor resets the timer (only applies to "cursor" positioning)
   */
  delayMs?: number;

  /**
   * Whether the anchor functionality is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * How to position the anchored content:
   * - "cursor": follows the mouse cursor (default)
   * - "element": centers on the trigger element
   * @default "cursor"
   */
  positioning?: PositioningMode;
}

interface UseHoverAnchorReturn {
  /** Current anchor position (null when not hovering) */
  anchorPos: { x: number; y: number } | null;
  /** Whether the anchored content should be visible (respects delay and enabled state) */
  isVisible: boolean;
  /** Handler to attach to onMouseMove on the trigger element */
  handleMouseMove: (e: React.MouseEvent) => void;
  /** Handler to attach to onMouseEnter on the trigger element (for element positioning) */
  handleMouseEnter: (e: React.MouseEvent) => void;
  /** Handler to attach to onMouseLeave on the trigger element */
  handleMouseLeave: () => void;
  /**
   * Props to spread on the anchored content to keep it visible while hovering
   * and prevent click events from bubbling to elements underneath.
   * Spread these on a wrapper element around the content.
   */
  contentProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
  /**
   * Renders content at the anchor position using a portal.
   * The render function receives the position and should return the content to render.
   */
  renderAtAnchor: (
    render: (pos: { x: number; y: number }) => React.ReactNode,
  ) => React.ReactNode;
  /**
   * Convenience method that renders a Tooltip component at the anchor position.
   */
  renderTooltip: (content: React.ReactNode) => React.ReactNode;
}

const HIDE_DELAY_MS = 150;

export function useHoverAnchor({
  delayMs = 0,
  enabled = true,
  positioning = "cursor",
}: UseHoverAnchorOptions = {}): UseHoverAnchorReturn {
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isActive, setIsActive] = useState(false);
  const { isAnchorActive, setAnchorActive, isAnchorActiveSync } =
    useHoverAnchorContext();

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // For element positioning, we store the element center once on enter
  const elementPosRef = useRef<{ x: number; y: number } | null>(null);

  // Track the previous anchorPos to detect actual position changes vs context-triggered re-runs
  const prevAnchorPosRef = useRef<{ x: number; y: number } | null>(null);

  // Track hide timeout and whether content is being hovered
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContentHoveredRef = useRef(false);

  useEffect(() => {
    if (!enabled || anchorPos === null) {
      prevAnchorPosRef.current = null;
      return;
    }

    // Immediate content (no delay) - takes precedence over delayed content
    if (delayMs === 0) {
      if (!isActiveRef.current) {
        setIsActive(true);
        setAnchorActive(true);
      }
      prevAnchorPosRef.current = anchorPos;
      return;
    }

    // For delayed content: don't start timer if another anchor is active
    // Use sync check to avoid race conditions with React's async state updates
    if (isAnchorActiveSync() && !isActiveRef.current) {
      prevAnchorPosRef.current = anchorPos;
      return;
    }

    // Check if anchorPos actually changed (vs effect triggered by isAnchorActive change)
    const anchorPosChanged =
      prevAnchorPosRef.current === null ||
      prevAnchorPosRef.current.x !== anchorPos.x ||
      prevAnchorPosRef.current.y !== anchorPos.y;

    // Delayed content - hide on movement and start timer
    // Only reset on movement for cursor positioning
    // IMPORTANT: Only do this if anchorPos actually changed (mouse moved),
    // not if the effect was triggered by isAnchorActive context change
    if (positioning === "cursor" && isActiveRef.current && anchorPosChanged) {
      setIsActive(false);
      setAnchorActive(false);
    }

    prevAnchorPosRef.current = anchorPos;

    // If content is already active and showing, don't restart the timer
    if (isActiveRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      if (!isAnchorActiveSync()) {
        setIsActive(true);
        setAnchorActive(true);
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    anchorPos,
    enabled,
    delayMs,
    positioning,
    isAnchorActive,
    setAnchorActive,
    isAnchorActiveSync,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (isActiveRef.current) {
        setAnchorActive(false);
      }
    };
  }, [setAnchorActive]);

  // Clear any pending hide timeout
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Actually perform the hide
  const doHide = useCallback(() => {
    setAnchorPos(null);
    elementPosRef.current = null;
    if (isActiveRef.current) {
      setIsActive(false);
      setAnchorActive(false);
    }
  }, [setAnchorActive]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      // Stop propagation so parent elements don't also show anchored content
      e.stopPropagation();

      if (positioning === "cursor") {
        // For delayed content, only update position if:
        // 1. Content is already showing (isActive), OR
        // 2. This is immediate content (delayMs === 0)
        // This prevents the timer from resetting on every mouse movement
        // during the delay period.
        if (delayMs === 0 || isActiveRef.current) {
          setAnchorPos({ x: e.clientX, y: e.clientY });
        }
      }
      // For element positioning, we use the stored element center
      // and only need to set it once on enter
    },
    [enabled, positioning, delayMs],
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.stopPropagation();

      // Cancel any pending hide when re-entering the trigger
      clearHideTimeout();

      if (positioning === "element") {
        // Get the bounding rect of the current target (the element with the handler)
        const target = e.currentTarget as HTMLElement | SVGElement;
        const rect = target.getBoundingClientRect();
        const centerPos = {
          x: rect.left + rect.width / 2,
          y: rect.top,
        };
        elementPosRef.current = centerPos;
        setAnchorPos(centerPos);
      } else {
        // For cursor positioning, set initial position
        setAnchorPos({ x: e.clientX, y: e.clientY });
      }
    },
    [enabled, positioning, clearHideTimeout],
  );

  const handleMouseLeave = useCallback(() => {
    // Delay hiding to allow mouse to move to content
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      // Only hide if content is not being hovered
      if (!isContentHoveredRef.current) {
        doHide();
      }
    }, HIDE_DELAY_MS);
  }, [clearHideTimeout, doHide]);

  // Handlers for content hover tracking
  const handleContentMouseEnter = useCallback(() => {
    isContentHoveredRef.current = true;
    clearHideTimeout();
  }, [clearHideTimeout]);

  const handleContentMouseLeave = useCallback(() => {
    isContentHoveredRef.current = false;
    // Start hide timer when leaving content
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      doHide();
    }, HIDE_DELAY_MS);
  }, [clearHideTimeout, doHide]);

  const isVisible = enabled && anchorPos !== null && isActive;

  // Use element position if available (for element positioning mode)
  const effectivePos =
    positioning === "element" && elementPosRef.current
      ? elementPosRef.current
      : anchorPos;

  // Generic render function that lets consumers provide their own rendering logic
  const renderAtAnchor = useCallback(
    (render: (pos: { x: number; y: number }) => React.ReactNode) => {
      if (!isVisible || typeof document === "undefined" || !effectivePos) {
        return null;
      }

      return createPortal(render(effectivePos), document.body);
    },
    [isVisible, effectivePos],
  );

  // Convenience method for rendering a simple tooltip
  const renderTooltip = useCallback(
    (content: React.ReactNode) => {
      return renderAtAnchor((pos) => (
        <Tooltip content={content} open={true}>
          <span
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Tooltip>
      ));
    },
    [renderAtAnchor],
  );

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    // Prevent clicks on the popover content from bubbling to elements underneath
    e.stopPropagation();
  }, []);

  const contentProps = useMemo(
    () => ({
      onMouseEnter: handleContentMouseEnter,
      onMouseLeave: handleContentMouseLeave,
      onClick: handleContentClick,
    }),
    [handleContentMouseEnter, handleContentMouseLeave, handleContentClick],
  );

  return {
    anchorPos: effectivePos,
    isVisible,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
    contentProps,
    renderAtAnchor,
    renderTooltip,
  };
}
