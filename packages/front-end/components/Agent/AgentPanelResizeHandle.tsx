import {
  KeyboardEvent,
  PointerEvent,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import Tooltip from "@/ui/Tooltip";
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_WIDTH,
  canResizePanel,
  clampPanelWidth,
  dragPanelWidth,
  keyPanelWidth,
  maxPanelWidth,
  SNAP_HOLD_MS,
} from "./agentPanelWidth";
import styles from "./AgentPanelResizeHandle.module.scss";

/** On <html> while dragging: no transitions, and the resize cursor everywhere. */
const RESIZING_CLASS = "agent-dock-resizing";

/** The widest the panel can be now, from the window and the side nav's room. */
function currentMax(): number {
  const navWidth =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--page-nav-width",
      ),
    ) || 0;
  return maxPanelWidth(window.innerWidth, navWidth);
}

/**
 * The docked panel's inner edge: drag it, or focus it and use the arrow keys,
 * to widen the panel (its default is its narrowest). Dragging well past the
 * widest and holding expands the panel instead; double-clicking puts it back
 * to its default width. Hidden when the window leaves no room to widen it.
 */
export default function AgentPanelResizeHandle({
  panelRef,
  width,
  onPreview,
  onCommit,
  onExpand,
}: {
  panelRef: RefObject<HTMLElement>;
  /** Your saved width; what shows may be less on a small window. */
  width: number;
  /** Shows a width while dragging, without saving it. */
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
  onExpand: () => void;
}) {
  const [max, setMax] = useState(() =>
    typeof window === "undefined" ? PANEL_DEFAULT_WIDTH : currentMax(),
  );
  // With the window, and with the side nav collapsing or expanding (its
  // class on <html> sets --page-nav-width).
  useEffect(() => {
    const update = () => setMax(currentMax());
    update();
    window.addEventListener("resize", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);
  const shown = clampPanelWidth(width, max);

  const drag = useRef<{
    startX: number;
    startWidth: number;
    max: number;
    width: number;
    /** Past the snap distance, counting down to arming. */
    holdTimer: number | null;
    /** Held long enough: releasing expands. */
    armed: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);

  const endDrag = () => {
    if (drag.current?.holdTimer) window.clearTimeout(drag.current.holdTimer);
    drag.current = null;
    setDragging(false);
    setSnapping(false);
    document.documentElement.classList.remove(RESIZING_CLASS);
  };
  useEffect(
    () => () => {
      if (drag.current?.holdTimer) window.clearTimeout(drag.current.holdTimer);
      document.documentElement.classList.remove(RESIZING_CLASS);
    },
    [],
  );
  // Esc cancels a drag, before anything else (e.g. closing the panel) sees
  // it: a drag leaves focus where it was, so it may not reach the handle.
  const cancelRef = useRef<() => void>(() => undefined);
  cancelRef.current = () => {
    const d = drag.current;
    if (!d) return;
    endDrag();
    onPreview(d.startWidth);
  };
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // No text selection, and focus stays where it was.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const dragMax = currentMax();
    setMax(dragMax);
    const startWidth = panelRef.current?.offsetWidth ?? shown;
    drag.current = {
      startX: e.clientX,
      startWidth,
      max: dragMax,
      width: startWidth,
      holdTimer: null,
      armed: false,
    };
    setDragging(true);
    document.documentElement.classList.add(RESIZING_CLASS);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = dragPanelWidth({
      startWidth: d.startWidth,
      startX: d.startX,
      x: e.clientX,
      max: d.max,
    });
    d.width = next.width;
    if (next.pastSnap && d.holdTimer === null && !d.armed) {
      // Held still produces no moves, so a timer arms it.
      d.holdTimer = window.setTimeout(() => {
        d.holdTimer = null;
        d.armed = true;
        setSnapping(true);
      }, SNAP_HOLD_MS);
    } else if (!next.pastSnap) {
      // Back inside: the hold starts over.
      if (d.holdTimer !== null) window.clearTimeout(d.holdTimer);
      d.holdTimer = null;
      d.armed = false;
      setSnapping(false);
    }
    onPreview(next.width);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    endDrag();
    if (d.armed) {
      // Expanding keeps the width you had, for when it docks again.
      onPreview(d.startWidth);
      onExpand();
    } else {
      onCommit(d.width);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keyMax = currentMax();
    setMax(keyMax);
    const next = keyPanelWidth(
      clampPanelWidth(width, keyMax),
      e.key,
      e.shiftKey,
      keyMax,
    );
    if (next === null) return;
    e.preventDefault();
    onCommit(next);
  };

  // Nowhere to widen it: no handle rather than one that doesn't move.
  if (!canResizePanel(max) && !dragging) return null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize AI assistant panel"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={0}
      className={clsx(
        styles.handle,
        dragging && styles.dragging,
        snapping && styles.snapping,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => cancelRef.current()}
      onDoubleClick={() => onCommit(PANEL_DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
      onFocus={() => setMax(currentMax())}
    >
      {/* Shown only once the drag is armed to expand; hovering never opens it. */}
      <Tooltip content="Release to expand" side="left" open={snapping}>
        <span className={styles.snapAnchor} aria-hidden="true" />
      </Tooltip>
    </div>
  );
}
