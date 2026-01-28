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

// Tracking tooltip visibility across all usages of useCursorTooltip
// to prevent multiple tooltips from showing at the same time
const tooltipVisibleRef = { current: false };

interface CursorTooltipContextValue {
  isTooltipVisible: boolean;
  setTooltipVisible: (visible: boolean) => void;
}

const CursorTooltipContext = createContext<CursorTooltipContextValue>({
  isTooltipVisible: false,
  setTooltipVisible: () => {},
});

export function CursorTooltipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  const setTooltipVisible = useCallback(
    (visible: boolean) => {
      tooltipVisibleRef.current = visible;
      setIsTooltipVisible(visible);
    },
    [setIsTooltipVisible],
  );

  const value = useMemo(
    () => ({
      isTooltipVisible,
      setTooltipVisible,
    }),
    [isTooltipVisible, setTooltipVisible],
  );

  return (
    <CursorTooltipContext.Provider value={value}>
      {children}
    </CursorTooltipContext.Provider>
  );
}

export function useCursorTooltipContext() {
  return useContext(CursorTooltipContext);
}

// Check tooltip visibility synchronously, outside of React async rendering
function isTooltipCurrentlyVisible(): boolean {
  return tooltipVisibleRef.current;
}

type PositioningMode = "cursor" | "element";

interface UseHoverTooltipOptions {
  /**
   * Delay in milliseconds before showing the tooltip.
   * When set to 0 (default), tooltip shows immediately.
   * When > 0, tooltip shows after the cursor has been idle for this duration.
   * Note: Moving the cursor resets the timer (only applies to "cursor" positioning)
   */
  delayMs?: number;

  /**
   * Whether the tooltip functionality is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * How to position the tooltip:
   * - "cursor": follows the mouse cursor (default)
   * - "element": centers on the trigger element
   * @default "cursor"
   */
  positioning?: PositioningMode;
}

interface UseHoverTooltipReturn {
  /** Current anchor position (null when not hovering) */
  anchorPos: { x: number; y: number } | null;
  /** Whether the tooltip should be visible (respects delay and enabled state) */
  isVisible: boolean;
  /** Handler to attach to onMouseMove on the trigger element */
  handleMouseMove: (e: React.MouseEvent) => void;
  /** Handler to attach to onMouseEnter on the trigger element (for element positioning) */
  handleMouseEnter: (e: React.MouseEvent) => void;
  /** Handler to attach to onMouseLeave on the trigger element */
  handleMouseLeave: () => void;
  /**
   * Renders content at the anchor position using a portal.
   * The render function receives the position and should return the content to render.
   * This allows consumers to use any component (Tooltip, Popover, custom) for rendering.
   */
  renderAtAnchor: (
    render: (pos: { x: number; y: number }) => React.ReactNode,
  ) => React.ReactNode;
  /**
   * Renders a Tooltip component at the anchor position.
   */
  renderTooltip: (content: React.ReactNode) => React.ReactNode;
}

export function useHoverTooltip({
  delayMs = 0,
  enabled = true,
  positioning = "cursor",
}: UseHoverTooltipOptions = {}): UseHoverTooltipReturn {
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isActive, setIsActive] = useState(false);
  const { isTooltipVisible, setTooltipVisible } = useCursorTooltipContext();

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // For element positioning, we store the element center once on enter
  const elementPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled || anchorPos === null) {
      return;
    }

    // Immediate tooltip (no delay) - takes precedence over delayed tooltips
    if (delayMs === 0) {
      if (!isActiveRef.current) {
        setIsActive(true);
        setTooltipVisible(true);
      }
      return;
    }

    // For delayed tooltips: don't start timer if another tooltip is visible
    if (isTooltipVisible && !isActiveRef.current) {
      return;
    }

    // Delayed tooltip - hide on movement and start timer
    // Only reset on movement for cursor positioning
    if (positioning === "cursor" && isActiveRef.current) {
      setIsActive(false);
      setTooltipVisible(false);
    }

    const timer = setTimeout(() => {
      if (!isTooltipCurrentlyVisible()) {
        setIsActive(true);
        setTooltipVisible(true);
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    anchorPos,
    enabled,
    delayMs,
    positioning,
    isTooltipVisible,
    setTooltipVisible,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isActiveRef.current) {
        setTooltipVisible(false);
      }
    };
  }, [setTooltipVisible]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      // Stop propagation so parent elements don't also show tooltips
      e.stopPropagation();

      if (positioning === "cursor") {
        setAnchorPos({ x: e.clientX, y: e.clientY });
      }
      // For element positioning, we use the stored element center
      // and only need to set it once on enter
    },
    [enabled, positioning],
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.stopPropagation();

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
    [enabled, positioning],
  );

  const handleMouseLeave = useCallback(() => {
    setAnchorPos(null);
    elementPosRef.current = null;
    if (isActive) {
      setIsActive(false);
      setTooltipVisible(false);
    }
  }, [isActive, setTooltipVisible]);

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

  return {
    anchorPos: effectivePos,
    isVisible,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
    renderAtAnchor,
    renderTooltip,
  };
}

// Legacy interface for backwards compatibility
interface UseCursorTooltipOptions {
  delayMs?: number;
  enabled?: boolean;
}

interface UseCursorTooltipReturn {
  cursorPos: { x: number; y: number } | null;
  isVisible: boolean;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseLeave: () => void;
  renderAtCursor: (
    render: (pos: { x: number; y: number }) => React.ReactNode,
  ) => React.ReactNode;
  renderTooltip: (content: React.ReactNode) => React.ReactNode;
}

/**
 * @deprecated Use useHoverTooltip instead for more flexibility.
 * Legacy hook that follows the cursor position.
 */
export function useCursorTooltip({
  delayMs = 0,
  enabled = true,
}: UseCursorTooltipOptions = {}): UseCursorTooltipReturn {
  const result = useHoverTooltip({ delayMs, enabled, positioning: "cursor" });

  return {
    cursorPos: result.anchorPos,
    isVisible: result.isVisible,
    handleMouseMove: (e: React.MouseEvent) => {
      result.handleMouseEnter(e);
      result.handleMouseMove(e);
    },
    handleMouseLeave: result.handleMouseLeave,
    renderAtCursor: result.renderAtAnchor,
    renderTooltip: result.renderTooltip,
  };
}

interface CursorTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
}

export function CursorTooltip({ content, children }: CursorTooltipProps) {
  const { handleMouseMove, handleMouseLeave, renderTooltip } = useCursorTooltip(
    { delayMs: 0 },
  );

  return (
    <>
      <span
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ display: "contents" }}
      >
        {children}
      </span>
      {renderTooltip(content)}
    </>
  );
}
