import {
  CSSProperties,
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ScrollArea as RadixScrollArea } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./ScrollArea.module.scss";

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
    /** Fades the content out at each edge with more past it. */
    edgeFades?: boolean;
    className?: string;
    style?: CSSProperties;
  }
>(function ScrollArea(
  {
    children,
    gutter = false,
    fill = false,
    direction = "vertical",
    edgeFades = false,
    className,
    style,
  },
  ref,
) {
  const viewport = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewport.current as HTMLDivElement, []);

  const [faded, setFaded] = useState("");
  useEffect(() => {
    const el = viewport.current;
    if (!edgeFades || !el) return;
    const vertical = direction !== "horizontal";
    const sideways = direction !== "vertical";
    const update = () => {
      const more = [
        vertical && el.scrollTop > 0 && "top",
        vertical &&
          el.scrollTop + el.clientHeight < el.scrollHeight - 1 &&
          "bottom",
        sideways && el.scrollLeft > 0 && "left",
        sideways &&
          el.scrollLeft + el.clientWidth < el.scrollWidth - 1 &&
          "right",
      ];
      setFaded(more.filter(Boolean).join(" "));
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
  }, [edgeFades, direction]);

  return (
    <RadixScrollArea
      ref={viewport}
      type="hover"
      scrollbars={direction}
      className={clsx(edgeFades && styles.edgeFades, className)}
      style={style}
      // Lands on the viewport, the element that scrolls.
      data-fade={faded || undefined}
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
});

export default ScrollArea;
