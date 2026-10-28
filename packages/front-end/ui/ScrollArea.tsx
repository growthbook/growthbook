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
    /** Keeps the content clear of the scrollbar drawn over it. */
    gutter?: boolean;
    /** A full-height column, so a child can fill it (`flex: 1`) or scroll. */
    fill?: boolean;
    direction?: "vertical" | "horizontal" | "both";
    /** The scrollbar's thickness: 4, 8 or 12px. */
    size?: "1" | "2" | "3";
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
    /** Edges left unmarked, such as one a pinned column marks itself. */
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
    direction = "vertical",
    size = "1",
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

  const skipped = skipEdges.join(" ");
  const [more, setMore] = useState<Edge[]>([]);
  useEffect(() => {
    const el = viewport.current;
    if (!edgeCue || !el) return;
    const vertical = direction !== "horizontal";
    const sideways = direction !== "vertical";
    const update = () => {
      const past: Record<Edge, boolean> = {
        top: vertical && el.scrollTop > 0,
        bottom:
          vertical && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
        left: sideways && el.scrollLeft > 0,
        right: sideways && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      };
      const next = (Object.keys(past) as Edge[]).filter(
        (edge) => past[edge] && !skipped.split(" ").includes(edge),
      );
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
  }, [edgeCue, direction, skipped]);

  useEffect(() => {
    const el = viewport.current;
    if (!wheelScrollsSideways || !el) return;
    // Wheel left to absorb at the end a wheel just reached, so finishing the
    // sideways scroll doesn't carry straight on into the page.
    let deadspace = 0;
    const onWheel = (e: WheelEvent) => {
      // A sideways swipe or shift-wheel already scrolls sideways.
      if (e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? el.clientWidth
            : 1;
      const delta = e.deltaY * unit;
      const atEnd = delta < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1;
      if (atEnd) {
        if (deadspace <= 0) return;
        e.preventDefault();
        deadspace -= Math.abs(delta);
        return;
      }
      e.preventDefault();
      const before = el.scrollLeft;
      el.scrollLeft += delta;
      const reached = delta < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1;
      const overshoot = Math.abs(delta) - Math.abs(el.scrollLeft - before);
      deadspace = reached ? WHEEL_DEADSPACE_PX - overshoot : 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelScrollsSideways]);

  const shadowed = edgeCue === "shadow";
  const scrollbarRoom = alwaysShow
    ? ({
        "--scrollbar-room": `calc(var(--space-${size}) + var(--space-1))`,
      } as CSSProperties)
    : undefined;
  const scrollArea = (
    <RadixScrollArea
      ref={viewport}
      type={alwaysShow ? "auto" : "hover"}
      size={size}
      scrollbars={direction}
      onScroll={onScroll}
      className={clsx(
        styles.root,
        alwaysShow && styles.reservesScrollbar,
        edgeCue === "fade" && styles.fades,
        shadowed ? styles.fillsWrapper : className,
      )}
      style={shadowed ? scrollbarRoom : { ...scrollbarRoom, ...style }}
      // Lands on the viewport, the element that scrolls.
      data-more={more.join(" ") || undefined}
    >
      <div
        style={{
          width: "100%",
          ...(gutter && { paddingRight: "var(--space-3)" }),
          ...(fill && {
            display: "flex",
            flexDirection: "column",
            height: "100%",
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
      {more.map((edge) => (
        <span key={edge} className={styles.shadow} data-edge={edge} />
      ))}
    </div>
  );
});

export default ScrollArea;
