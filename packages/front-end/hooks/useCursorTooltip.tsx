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

interface UseCursorTooltipOptions {
  /**
   * Delay in milliseconds before showing the tooltip.
   * When set to 0 (default), tooltip shows immediately.
   * When > 0, tooltip shows after the cursor has been idle for this duration.
   * Note: Moving the cursor resets the timer
   */
  delay?: number;

  /**
   * Whether the tooltip functionality is enabled.
   * @default true
   */
  enabled?: boolean;
}

interface UseCursorTooltipReturn {
  cursorPos: { x: number; y: number } | null;
  isVisible: boolean;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseLeave: () => void;
  renderTooltip: (content: React.ReactNode) => React.ReactNode;
}

export function useCursorTooltip({
  delay = 0,
  enabled = true,
}: UseCursorTooltipOptions = {}): UseCursorTooltipReturn {
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isActive, setIsActive] = useState(false);
  const { isTooltipVisible, setTooltipVisible } = useCursorTooltipContext();

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    if (!enabled || cursorPos === null) {
      return;
    }

    // Another tooltip is visible and we're not the active one
    if (isTooltipVisible && !isActiveRef.current) {
      return;
    }

    // Immediate tooltip (no delay)
    if (delay === 0) {
      if (!isActiveRef.current) {
        setIsActive(true);
        setTooltipVisible(true);
      }
      return;
    }

    // Delayed tooltip - hide on movement and start timer
    if (isActiveRef.current) {
      setIsActive(false);
      setTooltipVisible(false);
    }

    const timer = setTimeout(() => {
      if (!isTooltipCurrentlyVisible()) {
        setIsActive(true);
        setTooltipVisible(true);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [cursorPos, enabled, delay, isTooltipVisible, setTooltipVisible]);

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
      setCursorPos({ x: e.clientX, y: e.clientY });
    },
    [enabled],
  );

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null);
    if (isActive) {
      setIsActive(false);
      setTooltipVisible(false);
    }
  }, [isActive, setTooltipVisible]);

  const isVisible = enabled && cursorPos !== null && isActive;

  const renderTooltip = useCallback(
    (content: React.ReactNode) => {
      if (!isVisible || typeof document === "undefined") {
        return null;
      }

      return createPortal(
        <Tooltip content={content} open={true}>
          <span
            style={{
              position: "fixed",
              left: cursorPos.x,
              top: cursorPos.y,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Tooltip>,
        document.body,
      );
    },
    [isVisible, cursorPos],
  );

  return {
    cursorPos,
    isVisible,
    handleMouseMove,
    handleMouseLeave,
    renderTooltip,
  };
}

interface CursorTooltipProps {
  content: string;
  children: React.ReactNode;
}

export function CursorTooltip({ content, children }: CursorTooltipProps) {
  const { handleMouseMove, handleMouseLeave, renderTooltip } = useCursorTooltip(
    { delay: 0 },
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
