import {
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

/**
 * A scroll box whose scrollbars overlay the content, shown while hovered or
 * scrolled. The ref is the element that scrolls.
 */
const ScrollArea = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    /**
     * Keeps the content clear of the scrollbars drawn over it: a strip at the
     * right, and one at the bottom while it overflows sideways.
     */
    gutter?: boolean;
    /** A full-height column, so a child can fill it (`flex: 1`) or scroll. */
    fill?: boolean;
    /**
     * With `fill`, the content is held to the area's height, down to this
     * one, so a child can scroll itself; shorter than it, the area scrolls.
     */
    fillMinHeight?: string;
    direction?: "vertical" | "horizontal" | "both";
    /** The scrollbar's thickness: 4, 8 or 12px. */
    size?: Size<"sm" | "md" | "lg">;
    /** Shows the scrollbars whenever the content overflows, not just on hover. */
    alwaysShow?: boolean;
    /**
     * A vertical wheel over a sideways-only scroll moves it sideways; a little
     * past the end it reaches, the page takes over.
     */
    wheelScrollsSideways?: boolean;
    /**
     * Marks each edge with more content past it: the content fades out there,
     * or a shadow falls over it.
     */
    edgeCue?: "fade" | "shadow";
    /**
     * Edges marked instead by content pinned (sticky) to them, given
     * `pinnedTo`'s class: the shadow falls past it.
     */
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
    alwaysShow = false,
    wheelScrollsSideways = false,
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
    if ((!edgeCue && !sidewaysGutter) || !el) return;
    const update = () => {
      setOverflowsSideways(el.scrollWidth - el.clientWidth > 1);
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
  }, [edgeCue, sidewaysGutter, vertical, sideways]);

  useEffect(() => {
    const el = viewport.current;
    if (!wheelScrollsSideways || !el) return;
    // Wheel left to absorb at the end a wheel just reached, so finishing the
    // sideways scroll doesn't carry straight on into the page.
    let deadspace = 0;
    const onWheel = (e: WheelEvent) => {
      // A sideways swipe or shift-wheel already scrolls sideways; a pinch or
      // modified wheel zooms.
      if (
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey ||
        Math.abs(e.deltaY) <= Math.abs(e.deltaX)
      ) {
        return;
      }
      // A box inside that scrolls up and down keeps the wheel while it can.
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
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? el.clientWidth
            : 1;
      const delta = e.deltaY * unit;
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

  const shadowed = edgeCue === "shadow";
  const marked = more.filter((edge) => !skipEdges.includes(edge));
  const underPinned = more.filter((edge) => skipEdges.includes(edge));
  const scrollArea = (
    <RadixScrollArea
      ref={viewport}
      type={alwaysShow ? "auto" : "hover"}
      size={radixSize(size)}
      scrollbars={direction}
      onScroll={onScroll}
      className={clsx(
        styles.root,
        fill && styles.fullWidth,
        fill && fillMinHeight !== undefined && styles.bounded,
        edgeCue === "fade" && styles.fades,
        shadowed ? styles.fillsWrapper : className,
      )}
      style={shadowed ? undefined : style}
      // Lands on the viewport, the element that scrolls.
      data-more={marked.join(" ") || undefined}
      data-under-pinned={underPinned.join(" ") || undefined}
    >
      <div
        style={{
          width: "100%",
          ...(gutter && vertical && { paddingRight: "var(--space-3)" }),
          ...(sidewaysGutter &&
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
    <div className={clsx(styles.shadowed, className)} style={style}>
      {scrollArea}
      {marked.map((edge) => (
        <span key={edge} className={styles.shadow} data-edge={edge} />
      ))}
    </div>
  );
});

/**
 * For content pinned (sticky) to the area's top or left edge, which then
 * shadows that edge past itself while more scrolls under it. The area skips
 * that edge (`skipEdges`).
 */
export const pinnedTo = { top: styles.pinnedTop, left: styles.pinnedLeft };

export default ScrollArea;
