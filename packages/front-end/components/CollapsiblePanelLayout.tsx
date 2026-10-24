import {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "@/components/Layout/constants";
import useMediaQuery from "@/hooks/useMediaQuery";
import styles from "./CollapsiblePanelLayout.module.scss";

export const PANEL_WIDTH_PX = 360;
const MIN_PANEL_WIDTH_PX = 280;
/** The panel can take at most this share of the layout. */
const MAX_PANEL_SHARE = 2 / 3;
/** Drag this far past the minimum width to close the panel instead. */
const COLLAPSE_DELTA_PX = 60;
const HANDLE_WIDTH_PX = 20;
const SLIDE_MS = 160;

export interface Props {
  children: ReactNode;
  /** The right column. */
  panel: ReactNode;
  /** Sticks to the bottom of the content column, not under the panel. */
  footer?: ReactNode;
  open: boolean;
  /** Viewport offset the panel sticks to, below any fixed page header. */
  top?: number;
  /** Panel width in px. Fixed so it does not stretch on wide screens. */
  width?: number;
  /** The width a drag of the panel's edge ends at. */
  onWidthChange: (width: number) => void;
  /** A drag well past the minimum width closes the panel. */
  onCollapse: () => void;
}

/**
 * Two columns with a right panel that sticks alongside the content for the full
 * height of the screen. Wide enough, the panel docks and the content column
 * reflows beside it; narrower, the panel floats over the content instead so the
 * content keeps its width.
 */
export default function CollapsiblePanelLayout({
  children,
  panel,
  footer = null,
  open,
  top = 0,
  width = PANEL_WIDTH_PX,
  onWidthChange,
  onCollapse,
}: Props) {
  const overlay = useMediaQuery(
    `(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const layout = useRef<HTMLDivElement>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  useEffect(() => {
    const el = layout.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setLayoutWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  // Clamped at render rather than stored, so widening the window restores the
  // dragged width.
  const maxPanelWidth = layoutWidth
    ? Math.max(MIN_PANEL_WIDTH_PX, Math.round(layoutWidth * MAX_PANEL_SHARE))
    : Infinity;
  const panelWidth = Math.min(dragWidth ?? width, maxPanelWidth);
  const collapseBelow = MIN_PANEL_WIDTH_PX - COLLAPSE_DELTA_PX;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    let rawDrag = panelWidth;

    const clamp = (value: number) =>
      Math.round(Math.min(maxPanelWidth, Math.max(MIN_PANEL_WIDTH_PX, value)));

    const onMove = (move: PointerEvent) => {
      rawDrag = startWidth + (startX - move.clientX);
      setDragWidth(clamp(rawDrag));
      // Preview the collapse; nothing is committed until release.
      setPreviewCollapsed(rawDrag < collapseBelow);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragWidth(null);
      setPreviewCollapsed(false);
      if (rawDrag < collapseBelow) {
        onCollapse();
        return;
      }
      onWidthChange(clamp(rawDrag));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Until the page scrolls, the panel starts below its sticky offset, so a
  // viewport-minus-header height would hang off screen. Size it to what shows.
  useEffect(() => {
    const el = panelBox.current;
    if (!el) return;
    const fit = () => {
      const offset = Math.max(el.getBoundingClientRect().top, 0);
      el.style.height = `${Math.max(0, window.innerHeight - offset)}px`;
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  });

  // Never branch around `children`: moving it to a different position in the
  // tree would remount the whole page on every toggle, refetching its data.
  const showPanel = open && !previewCollapsed;

  // Stays mounted until the closing slide has run.
  const [mounted, setMounted] = useState(showPanel);
  const [expanded, setExpanded] = useState(showPanel);
  useEffect(() => {
    if (showPanel) {
      setMounted(true);
      return;
    }
    setExpanded(false);
    const timer = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [showPanel]);

  // Two frames: the browser must paint the zero width before it can animate
  // from it.
  useEffect(() => {
    if (!mounted || !showPanel) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [mounted, showPanel]);

  // Only the toggle animates; a drag tracks the pointer.
  const resizing = dragWidth !== null;

  const currentWidth = expanded ? panelWidth : 0;

  // Overlaid, the panel gives back its space and floats over the content.
  const overlaid = overlay
    ? {
        // Tracks the animated width so the right edge stays put mid-slide.
        marginLeft: -currentWidth,
        // Over the content's footer too, since it floats over that content.
        zIndex: 1002,
        // The pinned header's shadow, facing left. The negative spread keeps it
        // from bleeding above the panel.
        boxShadow:
          "-1px 0 2px -1px rgba(0, 0, 0, 0.1), -4px 0 4px -2px rgba(0, 0, 0, 0.025)",
      }
    : {};

  return (
    <Flex
      align="start"
      width="100%"
      ref={layout}
      // The drag handle straddles the panel's edge, which reaches the window's
      // while it slides; clip, not hidden, so nothing inside stops sticking.
      style={{ overflowX: "clip" }}
    >
      {/* At least as tall as the panel, so the footer starts at the bottom of
          the screen even under short content. */}
      <Flex
        direction="column"
        flexGrow="1"
        style={{ minWidth: 0, alignSelf: "stretch" }}
      >
        <Box flexGrow="1">{children}</Box>
        {footer}
      </Flex>
      {mounted ? (
        <Box
          ref={panelBox}
          position="sticky"
          flexShrink="0"
          width={`${currentWidth}px`}
          style={{
            top,
            // Until `fit` measures it.
            height: `calc(100vh - ${top}px)`,
            background: "var(--color-panel-solid)",
            // Matches the tab row's underline.
            borderLeft: expanded ? "1px solid var(--gray-a5)" : "none",
            transition: resizing
              ? "none"
              : `width ${SLIDE_MS}ms ease, margin-left ${SLIDE_MS}ms ease`,
            ...overlaid,
          }}
        >
          <Box
            onPointerDown={startDrag}
            className={styles.dragHandle}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: -HANDLE_WIDTH_PX / 2,
              width: HANDLE_WIDTH_PX,
              cursor: "col-resize",
              touchAction: "none",
              zIndex: 1,
            }}
          />
          {/* Clips the contents mid-slide; the handle sits outside it so it
              can straddle the border. */}
          <Box height="100%" style={{ overflow: "hidden" }}>
            {/* Holds its width mid-slide so the contents don't reflow. A
                full-height column: the panel lays out and scrolls its own. */}
            <Flex
              direction="column"
              height="100%"
              style={{ width: `${panelWidth}px` }}
            >
              {panel}
            </Flex>
          </Box>
        </Box>
      ) : null}
    </Flex>
  );
}
