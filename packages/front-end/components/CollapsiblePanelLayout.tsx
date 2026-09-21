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
import { SAVE_BAR_RESIZE_EVENT } from "@/components/Experiment/TabbedPage/UnsavedEditsBar";
import styles from "./CollapsiblePanelLayout.module.scss";

export const PANEL_WIDTH_PX = 360;
const MIN_PANEL_WIDTH_PX = 280;
/** The panel can take at most this share of the layout. */
const MAX_PANEL_SHARE = 2 / 3;
/** Drag this far past the minimum width to close the panel instead. */
const COLLAPSE_DELTA_PX = 60;
const HANDLE_WIDTH_PX = 20;
/** How long the panel takes to slide open or shut. */
const SLIDE_MS = 160;

export interface Props {
  /** The main content. */
  children: ReactNode;
  /** The right column. */
  panel: ReactNode;
  open: boolean;
  /** Viewport offset the panel sticks to, below any fixed page header. */
  top?: number;
  /** Panel width in px. Fixed so it does not stretch on wide screens. */
  width?: number;
  /** Omit to make the panel a fixed width with no drag handle. */
  onWidthChange?: (width: number) => void;
  /** Lets a drag well past the minimum width close the panel. */
  onCollapse?: () => void;
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
  const dragged = useRef(width);
  const rawDrag = useRef(width);
  // A window that shrinks holds the panel to its share without rewriting the
  // width the user dragged: widen the window again and it comes back.
  const maxPanelWidth = layoutWidth
    ? Math.max(MIN_PANEL_WIDTH_PX, Math.round(layoutWidth * MAX_PANEL_SHARE))
    : Infinity;
  const panelWidth = Math.min(dragWidth ?? width, maxPanelWidth);
  const collapseBelow = MIN_PANEL_WIDTH_PX - COLLAPSE_DELTA_PX;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    e.preventDefault();
    const startX = e.clientX;
    dragged.current = panelWidth;
    rawDrag.current = panelWidth;

    const clamp = (value: number, min: number) =>
      Math.round(Math.min(maxPanelWidth, Math.max(min, value)));

    const startWidth = panelWidth;
    const onMove = (move: PointerEvent) => {
      rawDrag.current = startWidth + (startX - move.clientX);
      dragged.current = clamp(rawDrag.current, MIN_PANEL_WIDTH_PX);
      setDragWidth(dragged.current);
      // Drag on past the minimum and the panel vanishes, so the close is
      // visible before the pointer comes up. Dragging back brings it straight
      // back; nothing is committed until release.
      setPreviewCollapsed(!!onCollapse && rawDrag.current < collapseBelow);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragWidth(null);
      setPreviewCollapsed(false);
      if (onCollapse && rawDrag.current < collapseBelow) {
        onCollapse();
        return;
      }
      onWidthChange(dragged.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // The panel sticks below the page header, but until the page is scrolled it
  // starts lower than that, and a height of "the viewport minus the header"
  // then hangs off the bottom of the screen. Measure what is actually visible
  // instead, so anything held at the panel's bottom stays on screen.
  useEffect(() => {
    const el = panelBox.current;
    if (!el) return;
    const fit = () => {
      const offset = Math.max(el.getBoundingClientRect().top, 0);
      // The save bar sits over the bottom of the window, so the panel stops
      // above it rather than having everything inside it pad itself clear.
      const bar =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--experiment-save-bar-height",
          ),
        ) || 0;
      el.style.height = `${Math.max(0, window.innerHeight - offset - bar)}px`;
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    window.addEventListener(SAVE_BAR_RESIZE_EVENT, fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      window.removeEventListener(SAVE_BAR_RESIZE_EVENT, fit);
    };
  });

  // Never branch around `children`: moving it to a different position in the
  // tree would remount the whole page on every toggle, refetching its data.
  const showPanel = open && !previewCollapsed;

  // The panel slides rather than blinking in and out, so it stays mounted until
  // its closing slide has run.
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

  // Two frames: the first lets the browser paint the panel at zero width, so
  // the widening that follows is something it can animate from.
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

  // A drag tracks the pointer exactly: sliding to each new width would just
  // read as lag. Only the toggle animates.
  const resizing = dragWidth !== null;

  const currentWidth = expanded ? panelWidth : 0;

  // Overlaying keeps the content column at full width: the panel gives back the
  // space it occupies and floats over the right of the content instead.
  const overlaid = overlay
    ? {
        // Tied to the animated width so the panel's right edge stays put and it
        // slides in from the side rather than growing off-screen.
        marginLeft: -currentWidth,
        zIndex: 900,
        // Same shadow as the pinned page header, turned to face left. The
        // negative spread cancels the blur vertically so it cannot bleed above
        // the panel and read as a second line under the tab row.
        boxShadow:
          "-1px 0 2px -1px rgba(0, 0, 0, 0.1), -4px 0 4px -2px rgba(0, 0, 0, 0.025)",
      }
    : {};

  return (
    <Flex align="start" width="100%" ref={layout}>
      <Box flexGrow="1" style={{ minWidth: 0 }}>
        {children}
      </Box>
      {mounted ? (
        <Box
          ref={panelBox}
          position="sticky"
          flexShrink="0"
          width={`${currentWidth}px`}
          style={{
            top,
            // Replaced on every scroll by what the panel can actually see.
            height: `calc(100vh - ${top}px)`,
            background: "var(--color-panel-solid)",
            // Matches the tab row's underline.
            borderLeft: expanded ? "1px solid var(--gray-a5)" : "none",
            overflow: "hidden",
            transition: resizing
              ? "none"
              : `width ${SLIDE_MS}ms ease, margin-left ${SLIDE_MS}ms ease`,
            ...overlaid,
          }}
        >
          {onWidthChange ? (
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
            ></Box>
          ) : null}
          {/* Holds its width while the panel slides, so the contents do not
              reflow on the way in or out. */}
          <Box
            height="100%"
            style={{
              overflowY: "auto",
              width: `${panelWidth}px`,
              // A column, so a panel that wants to fill the height can.
              display: "flex",
              flexDirection: "column",
            }}
          >
            {panel}
          </Box>
        </Box>
      ) : null}
    </Flex>
  );
}
