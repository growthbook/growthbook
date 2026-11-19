import {
  ComponentProps,
  CSSProperties,
  forwardRef,
  ReactNode,
  UIEventHandler,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ScrollArea as RadixScrollArea } from "@radix-ui/themes";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";
import styles from "./ScrollArea.module.scss";

type Edge = "top" | "bottom" | "left" | "right";

const WHEEL_DEADSPACE_PX = 100;
// A trackpad swipe carries some sideways movement; a mouse wheel's never does.
const TRACKPAD_MEMORY_MS = 600;

function sidewaysWheelDelta(e: WheelEvent, el: HTMLElement): number {
  const unit =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? el.clientWidth
        : 1;
  return e.deltaY * unit;
}

// Scrollbars overlay the content. The ref is the element that scrolls.
const ScrollArea = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    // Keeps the content clear of the overlaid scrollbars.
    gutter?: boolean;
    // A full-height column a child can fill or scroll within.
    fill?: boolean;
    // With `fill`, how short the content gets before the area scrolls instead.
    fillMinHeight?: string;
    direction?: "vertical" | "horizontal" | "both";
    size?: Size<"sm" | "md" | "lg">;
    type?: ComponentProps<typeof RadixScrollArea>["type"];
    // Sticks the sideways scrollbar to the window's bottom along a tall area.
    pinScrollbar?: boolean;
    // Where a vertical wheel scrolls sideways: over the scrollbar, or the whole
    // area (trackpads excepted).
    wheelScrollsSideways?: "area" | "scrollbar";
    // Marks each edge with more content past it.
    edgeCue?: "fade" | "shadow" | "deep-shadow";
    // Edges left unmarked, e.g. under content stuck there with `pinnedTo`.
    skipEdges?: Edge[];
    onScroll?: UIEventHandler<HTMLDivElement>;
    className?: string;
    style?: CSSProperties;
  }
>(function ScrollArea(
  {
    children,
    gutter = false,
    fill = false,
    fillMinHeight,
    direction = "vertical",
    size = "sm",
    type = "hover",
    pinScrollbar = false,
    wheelScrollsSideways,
    edgeCue,
    skipEdges = [],
    onScroll,
    className,
    style,
  },
  ref,
) {
  const viewport = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewport.current as HTMLDivElement, []);

  const vertical = direction !== "horizontal";
  const sideways = direction !== "vertical";
  const sidewaysGutter = gutter && sideways;
  const [more, setMore] = useState<Edge[]>([]);
  const [overflowsSideways, setOverflowsSideways] = useState(false);
  useEffect(() => {
    const el = viewport.current;
    if ((!edgeCue && !sidewaysGutter && !pinScrollbar) || !el) return;
    const update = () => {
      // Radix's own test for showing the sideways bar.
      setOverflowsSideways(el.offsetWidth < el.scrollWidth);
      if (!edgeCue) return;
      const past: Record<Edge, boolean> = {
        top: vertical && el.scrollTop > 0,
        bottom:
          vertical && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
        left: sideways && el.scrollLeft > 0,
        right: sideways && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      };
      const next = (Object.keys(past) as Edge[]).filter((edge) => past[edge]);
      setMore((prev) => (prev.join() === next.join() ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // The viewport's own child grows with the content.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [edgeCue, sidewaysGutter, pinScrollbar, vertical, sideways]);

  useEffect(() => {
    const el = viewport.current;
    if (wheelScrollsSideways !== "area" || !el) return;
    // Absorbed at an end, so the page doesn't take over mid-gesture.
    let deadspace = 0;
    let sidewaysAt = -Infinity;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) sidewaysAt = e.timeStamp;
      // Left alone: sideways and modified wheels, ones an inner scroller
      // (a code editor) took, and trackpads.
      if (
        e.defaultPrevented ||
        e.timeStamp - sidewaysAt < TRACKPAD_MEMORY_MS ||
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey ||
        Math.abs(e.deltaY) <= Math.abs(e.deltaX)
      ) {
        return;
      }
      // An inner box that scrolls up and down keeps the wheel while it can.
      for (
        let node = e.target instanceof Element ? e.target : null;
        node && node !== el;
        node = node.parentElement
      ) {
        const room =
          e.deltaY < 0
            ? node.scrollTop > 0
            : node.scrollTop + node.clientHeight < node.scrollHeight - 1;
        if (room && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
          return;
        }
      }
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const delta = sidewaysWheelDelta(e, el);
      const atEnd = () =>
        delta < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1;
      if (atEnd()) {
        if (deadspace <= 0) return;
        e.preventDefault();
        deadspace -= Math.abs(delta);
        return;
      }
      e.preventDefault();
      const before = el.scrollLeft;
      el.scrollLeft += delta;
      const overshoot = Math.abs(delta) - Math.abs(el.scrollLeft - before);
      deadspace = atEnd() ? WHEEL_DEADSPACE_PX - overshoot : 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelScrollsSideways]);

  // Over the scrollbar (or a pinned one's gutter), outside what scrolls, a
  // vertical wheel scrolls sideways until an end.
  useEffect(() => {
    const el = viewport.current;
    const root = el?.parentElement;
    if (!wheelScrollsSideways || !el || !root) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (
        !target ||
        el.contains(target) ||
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        Math.abs(e.deltaY) <= Math.abs(e.deltaX)
      ) {
        return;
      }
      const max = el.scrollWidth - el.clientWidth;
      const delta = sidewaysWheelDelta(e, el);
      const atEnd = delta < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1;
      if (max <= 0 || atEnd) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [wheelScrollsSideways]);

  const shadowed = edgeCue === "shadow" || edgeCue === "deep-shadow";
  // With nothing past the sides, no bar, so no gutter to pin over the content.
  const pinned = pinScrollbar && overflowsSideways;
  const marked = more.filter((edge) => !skipEdges.includes(edge));
  const underPinned = more.filter((edge) => skipEdges.includes(edge));
  const scrollArea = (
    <RadixScrollArea
      ref={viewport}
      type={pinScrollbar ? "auto" : type}
      size={radixSize(size)}
      scrollbars={direction}
      onScroll={onScroll}
      className={clsx(
        styles.root,
        (fill || !sideways) && styles.fullWidth,
        fill && fillMinHeight !== undefined && styles.bounded,
        edgeCue === "fade" && styles.fades,
        pinned && styles.pinsScrollbar,
        shadowed ? styles.fillsWrapper : className,
      )}
      style={{
        ...(shadowed ? undefined : style),
        ...(pinned && {
          "--pinned-scrollbar-size": `var(--space-${radixSize(size)})`,
        }),
      }}
      // Radix puts these on the viewport.
      data-more={marked.join(" ") || undefined}
      data-under-pinned={underPinned.join(" ") || undefined}
    >
      <div
        style={{
          width: "100%",
          ...(gutter && vertical && { paddingRight: "var(--space-3)" }),
          // A pinned scrollbar takes its own room.
          ...(sidewaysGutter &&
            !pinScrollbar &&
            overflowsSideways && {
              paddingBottom: `calc(var(--space-${radixSize(size)}) + var(--space-1))`,
            }),
          ...(fill && {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: fillMinHeight,
          }),
        }}
      >
        {children}
      </div>
    </RadixScrollArea>
  );
  if (!shadowed) return scrollArea;

  return (
    <div
      className={clsx(
        styles.shadowed,
        edgeCue === "deep-shadow" && styles.deep,
        className,
      )}
      style={style}
      data-under-pinned={underPinned.join(" ") || undefined}
    >
      {scrollArea}
      {marked.map((edge) => (
        <span key={edge} className={styles.shadow} data-edge={edge} />
      ))}
    </div>
  );
});

// For content stuck to an edge, which shadows past itself while more scrolls
// under it; skip that edge in `skipEdges`. Bottom is the area's next sibling.
export const pinnedTo = {
  top: styles.pinnedTop,
  left: styles.pinnedLeft,
  bottom: styles.pinnedBottom,
};

export default ScrollArea;
