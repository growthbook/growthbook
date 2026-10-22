import { CSSProperties, forwardRef, ReactNode } from "react";
import { ScrollArea as RadixScrollArea } from "@radix-ui/themes";

/**
 * A vertical scroll box whose scrollbar draws over the content, and only while
 * it's hovered or scrolled, whatever the OS setting. The ref is the element
 * that scrolls.
 */
const ScrollArea = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    /** Keeps the content clear of the scrollbar drawn over it. */
    gutter?: boolean;
    /**
     * Lays the content out as a column as tall as the box, so a child can fill
     * it (`flex: 1`) or scroll inside it.
     */
    fill?: boolean;
    className?: string;
    style?: CSSProperties;
  }
>(function ScrollArea(
  { children, gutter = false, fill = false, className, style },
  ref,
) {
  return (
    <RadixScrollArea
      ref={ref}
      type="hover"
      scrollbars="vertical"
      className={className}
      style={style}
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
