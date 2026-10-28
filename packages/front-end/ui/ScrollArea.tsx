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

/**
 * A scroll box whose scrollbars overlay the content, shown only while hovered
 * or scrolled. The ref is the element that scrolls.
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

  const shadowed = edgeCue === "shadow";
  const scrollArea = (
    <RadixScrollArea
      ref={viewport}
      type="hover"
      scrollbars={direction}
      onScroll={onScroll}
      className={
        shadowed
          ? styles.isolated
          : clsx(edgeCue === "fade" && styles.fades, className)
      }
      style={shadowed ? undefined : style}
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
