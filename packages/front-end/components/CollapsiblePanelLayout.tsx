import {
  createContext,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiSidebarSimple, PiSidebarSimpleFill } from "react-icons/pi";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "@/components/Layout/constants";
import useMediaQuery from "@/hooks/useMediaQuery";
import Tooltip from "@/ui/Tooltip";
import styles from "./CollapsiblePanelLayout.module.scss";

export const PANEL_WIDTH_PX = 360;
const MIN_PANEL_WIDTH_PX = 280;
const MAX_PANEL_SHARE = 2 / 3;
// The narrowest the content takes beside a docked panel without overlapping or
// cutting off (the experiment page's linked changes and Hypothesis), unless a
// page needs more. Less room than this beside it, the panel floats instead.
const MIN_CONTENT_WIDTH_PX = 540;
// Drag this far past the minimum width to close the panel instead.
const COLLAPSE_DELTA_PX = 60;
const HANDLE_WIDTH_PX = 20;
const SLIDE_MS = 160;

// True while the panel slides open or shut, narrowing or widening the content
// beside it each frame. What reflows in steps (a grid counting its columns)
// can hold still until it's done, and lay out once.
export const PanelSlidingContext = createContext(false);

// The room a left panel leaves its content once settled, 0 until measured. A
// panel nested beside it sizes against this, so it decides to float only once.
const SettledRoomContext = createContext<number | null>(null);

export interface Props {
  children: ReactNode;
  panel: ReactNode;
  // Sticks to the bottom of the content column; a floating panel ends above it.
  footer?: ReactNode;
  open: boolean;
  // CSS length the panel sticks to, below any fixed page header, e.g.
  // "var(--tabs-bottom)".
  top?: string;
  // Fixed so the panel does not stretch on wide screens.
  width?: number;
  onWidthChange: (width: number) => void;
  // A drag well past the minimum width closes the panel.
  onCollapse: () => void;
  onFloatChange?: (floats: boolean) => void;
  // Takes no input in the content, while the footer stays usable.
  busy?: boolean;
  side?: "left" | "right";
  // The room the content needs beside a docked panel; with less, it floats.
  minContentWidth?: number;
}

// A side panel that sticks beside the content at full screen height. Wide, it
// docks and the content reflows; narrow, or with too little room beside it, it
// floats so the content keeps its width.
export default function CollapsiblePanelLayout({
  children,
  panel,
  footer = null,
  open,
  top = "0px",
  width = PANEL_WIDTH_PX,
  onWidthChange,
  onCollapse,
  onFloatChange,
  busy = false,
  side = "right",
  minContentWidth = MIN_CONTENT_WIDTH_PX,
}: Props) {
  const left = side === "left";
  const narrowWindow = useMediaQuery(
    `(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const layout = useRef<HTMLDivElement>(null);
  const footerBox = useRef<HTMLDivElement>(null);
  const contentBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentBox.current) contentBox.current.inert = busy;
  }, [busy]);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  // Before paint, so a panel that floats never shows docked first.
  useLayoutEffect(() => {
    const el = layout.current;
    const footerEl = footerBox.current;
    if (!el || !footerEl) return;
    setLayoutWidth(el.getBoundingClientRect().width);
    setFooterHeight(footerEl.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) setLayoutWidth(entry.contentRect.width);
        else setFooterHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    observer.observe(footerEl);
    return () => observer.disconnect();
  }, []);
  // Where the layout starts on the page, so it can reach the screen's bottom
  // and no further.
  const [layoutTop, setLayoutTop] = useState(0);
  // Before paint, so the first frame isn't drawn a screen tall.
  useLayoutEffect(() => {
    const el = layout.current;
    if (!el) return;
    const measure = () =>
      setLayoutTop(el.getBoundingClientRect().top + window.scrollY);
    measure();
    // Moved by whatever above it changes size: what comes before it, and
    // before each of its ancestors. A page held a screen tall wouldn't
    // change size with them.
    const observer = new ResizeObserver(measure);
    for (let node: Element | null = el; node && node !== document.body; ) {
      for (let s = node.previousElementSibling; s; s = s.previousElementSibling)
        observer.observe(s);
      node = node.parentElement;
    }
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const settledRoom = useContext(SettledRoomContext);
  const room = !left && settledRoom !== null ? settledRoom : layoutWidth;
  // Clamped at render rather than stored, so widening the window restores the
  // dragged width. Docked, it also leaves the content minContentWidth, so
  // dragging it wider never flips it to floating.
  const maxPanelWidth = room
    ? Math.max(
        MIN_PANEL_WIDTH_PX,
        Math.min(
          Math.round(room * MAX_PANEL_SHARE),
          narrowWindow && !left ? Infinity : room - minContentWidth,
        ),
      )
    : Infinity;
  const panelWidth = Math.min(dragWidth ?? width, maxPanelWidth);
  // Without a drag in progress, which commits its width only on release.
  const panelWidthAtRest = Math.min(width, maxPanelWidth);
  const collapseBelow = MIN_PANEL_WIDTH_PX - COLLAPSE_DELTA_PX;
  // Floats on a narrow window, or when even the narrowest panel would squeeze
  // the content. The layout's own width holds still as the panel docks or
  // floats, so it can't flip back and forth.
  const overlay =
    !left &&
    (narrowWindow || (room > 0 && room - panelWidth < minContentWidth));
  const measured = narrowWindow || room > 0;
  useLayoutEffect(() => {
    if (measured) onFloatChange?.(overlay);
  }, [measured, overlay, onFloatChange]);
  // Floating, the panel ends where the footer starts, so the footer stays whole.
  const footerClearance = overlay ? footerHeight : 0;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    let rawDrag = panelWidth;

    const clamp = (value: number) =>
      Math.round(Math.min(maxPanelWidth, Math.max(MIN_PANEL_WIDTH_PX, value)));

    const onMove = (move: PointerEvent) => {
      rawDrag =
        startWidth + (left ? move.clientX - startX : startX - move.clientX);
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

  const [slidingFor, setSlidingFor] = useState(showPanel);
  const [sliding, setSliding] = useState(false);
  if (slidingFor !== showPanel) {
    setSlidingFor(showPanel);
    setSliding(true);
  }
  useEffect(() => {
    if (!sliding) return;
    // An open waits two frames before it starts.
    const timer = setTimeout(() => setSliding(false), SLIDE_MS + 50);
    return () => clearTimeout(timer);
  }, [sliding, showPanel]);

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
  // Nor before the first paint: a panel that floats on load closes at once.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // A close starts sliding with the render that closes it, so the content
  // beside it never holds still at the old width; an open waits for the zero
  // width to paint.
  const shown = expanded && showPanel;
  const currentWidth = shown ? panelWidth : 0;
  const docked = shown && !overlay;

  // Overlaid, the panel gives back its space and floats over the content.
  const overlaid = overlay
    ? {
        // Tracks the animated width so the outer edge stays put mid-slide.
        ...(left
          ? { marginRight: -currentWidth }
          : { marginLeft: -currentWidth }),
        // Keeps the content column reaching the bottom of the screen, where
        // the footer sits under the shortened panel.
        marginBottom: footerClearance,
        zIndex: 1002,
        // The pinned header's shadow, facing the content. The negative spread
        // keeps it from bleeding above the panel.
        boxShadow: left
          ? "1px 0 2px -1px var(--lift-shadow-near), 4px 0 4px -2px var(--lift-shadow-far)"
          : "-1px 0 2px -1px var(--lift-shadow-near), -4px 0 4px -2px var(--lift-shadow-far)",
      }
    : {};
  // Matches the tab row's underline.
  const edge = shown ? "1px solid var(--gray-a5)" : "none";

  const panelBox = mounted ? (
    <Box
      position="sticky"
      flexShrink="0"
      width={`${currentWidth}px`}
      style={{
        top,
        // As tall as the content beside it, up to its stuck height. Taller
        // before it sticks, its end would run past the window's and make
        // the page scroll. Its own contents don't size it.
        alignSelf: "stretch",
        contain: "size",
        maxHeight: `calc(100vh - ${top} - ${footerClearance}px)`,
        background: "var(--color-panel-solid)",
        ...(left ? { borderRight: edge } : { borderLeft: edge }),
        transition:
          resizing || !painted
            ? "none"
            : `width ${SLIDE_MS}ms ease, ${left ? "margin-right" : "margin-left"} ${SLIDE_MS}ms ease`,
        ...overlaid,
      }}
    >
      <Box
        onPointerDown={startDrag}
        className={clsx(styles.dragHandle, left && styles.dragHandleLeft)}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...(left
            ? { right: -HANDLE_WIDTH_PX / 2 }
            : { left: -HANDLE_WIDTH_PX / 2 }),
          width: HANDLE_WIDTH_PX,
          cursor: "col-resize",
          touchAction: "none",
          zIndex: 1,
        }}
      />
      {/* Clips the contents mid-slide; the handle sits outside it so it
          can straddle the border. Clip, not hidden, so what's inside can
          still stick to the window. */}
      <Box height="100%" style={{ overflow: "clip" }}>
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
  ) : null;

  return (
    <Flex
      align="start"
      width="100%"
      ref={layout}
      // For what's laid out around it: whether the panel takes room beside
      // the content.
      data-panel-docked={docked && !left ? "" : undefined}
      data-left-panel-docked={docked && left ? "" : undefined}
      // The drag handle straddles the panel's edge, which reaches the window's
      // while it slides; clip, not hidden, so nothing inside stops sticking.
      // To the bottom of the screen, so the footer starts there even under
      // short content.
      style={{ overflowX: "clip", minHeight: `calc(100vh - ${layoutTop}px)` }}
    >
      {left ? panelBox : null}
      {/* As tall as the layout. */}
      <Flex
        direction="column"
        flexGrow="1"
        style={{ minWidth: 0, alignSelf: "stretch" }}
      >
        <Box ref={contentBox} flexGrow="1" aria-busy={busy}>
          <PanelSlidingContext.Provider value={sliding}>
            <SettledRoomContext.Provider
              value={
                left
                  ? layoutWidth && layoutWidth - (open ? panelWidthAtRest : 0)
                  : settledRoom
              }
            >
              {children}
            </SettledRoomContext.Provider>
          </PanelSlidingContext.Provider>
        </Box>
        <div ref={footerBox} className={styles.footer}>
          {footer}
        </div>
      </Flex>
      {left ? null : panelBox}
    </Flex>
  );
}

// Opens and closes the panel, from the tab bar beside it.
export function DetailsPanelToggle({
  open,
  setOpen,
  side = "right",
  name = "details",
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  side?: "left" | "right";
  name?: string;
}) {
  const left = side === "left";
  const label = `${open ? "Hide" : "Show"} ${name}`;
  const Icon = open ? PiSidebarSimpleFill : PiSidebarSimple;
  return (
    <Tooltip content={label}>
      <IconButton
        type="button"
        size="1"
        variant="ghost"
        color="gray"
        style={{
          // Ghost sizes itself from its padding; pin the box so the toggle
          // does not shift as it flips. Nudged past the row's end, toward the
          // page's edge; same footprint, so nothing beside it moves.
          margin: 0,
          marginLeft: left ? "calc(-1 * var(--space-1))" : "var(--space-5)",
          marginRight: left ? "var(--space-1)" : "calc(-1 * var(--space-3))",
          padding: 0,
          width: "var(--space-5)",
          height: "var(--space-5)",
        }}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {/* The small bar on the panel's side. */}
        <Icon
          size={16}
          style={left ? undefined : { transform: "scaleX(-1)" }}
        />
      </IconButton>
    </Tooltip>
  );
}
