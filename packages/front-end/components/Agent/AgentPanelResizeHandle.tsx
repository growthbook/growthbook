import {
  KeyboardEvent,
  PointerEvent,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  dragPanelWidth,
  keyPanelWidth,
  maxPanelWidth,
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
 * to resize the panel. Dragging well past the widest expands the panel
 * instead; double-clicking puts it back to its default width.
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
  useEffect(() => {
    const update = () => setMax(currentMax());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const shown = clampPanelWidth(width, max);

  const drag = useRef<{
    startX: number;
    startWidth: number;
    max: number;
    width: number;
    snap: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
    setSnapping(false);
    document.documentElement.classList.remove(RESIZING_CLASS);
  };
  useEffect(
    () => () => document.documentElement.classList.remove(RESIZING_CLASS),
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
      snap: false,
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
    d.snap = next.snap;
    setSnapping(next.snap);
    onPreview(next.width);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    endDrag();
    if (d.snap) {
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
      {snapping ? (
        <span className={styles.snapHint} aria-hidden="true">
          Release to expand
        </span>
      ) : null}
    </div>
  );
}
