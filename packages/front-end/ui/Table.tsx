import React, { forwardRef, useEffect, useRef, useState } from "react";
import { Box, Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";
import styles from "./Table.module.scss";

export type TableProps = Omit<
  React.ComponentProps<typeof RadixTable.Root>,
  "variant" | "size"
> & {
  /** "list" enables list-table wrapper, scroll, and styling; "surface" | "ghost" are passed to Radix */
  variant?: "list" | "surface" | "ghost";
  size?: Size<"sm" | "md" | "lg">;
  /** When true (or when variant="list"), header row is sticky; when false, list variant keeps styling but header does not stick */
  stickyHeader?: boolean;
  /** Top offset in px for sticky header (default: under the app header and whatever the page pins there, --page-sticky-top). Used as CSS var --table-sticky-top. */
  stickyTopOffset?: number;
  /** When true (or when variant="list"), first header row gets rounded top corners */
  roundedCorners?: boolean;
  /**
   * Opt in to a bounded scroll region so wide tables scroll horizontally. The
   * header then sticks to that region instead of the viewport — the list variant
   * neutralises Radix's own scroll area to get viewport-sticky headers, and
   * overflow-x can't scroll without overflow-y doing the same.
   */
  scrollX?: boolean;
  /** Pins the last column to the right edge while the rest scrolls under it, in a `scrollX` region or once the table is too wide for the page. */
  stickyLastColumn?: boolean;
  /**
   * Height cap for the `scrollX` region, e.g. 480 or "60vh". Without it the
   * region grows to the viewport, which pushes anything below the table (such
   * as pagination) out of view.
   */
  maxHeight?: number | string;
  /**
   * px floor for the table itself. Under a fixed layout a column with no width
   * takes only the leftover space, so without a floor it collapses to zero once
   * the specified widths fill the container. `useTableColumns` computes this.
   */
  minTableWidth?: number;
};

export default function Table({
  children,
  variant,
  size,
  stickyHeader,
  stickyTopOffset,
  roundedCorners,
  scrollX,
  stickyLastColumn,
  maxHeight,
  minTableWidth,
  className,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
  ...props
}: TableProps) {
  const margins = { m, mx, my, mt, mr, mb, ml };
  const isListVariant =
    variant === "list" || stickyHeader === true || roundedCorners === true;
  const useStickyHeader =
    (variant === "list" && stickyHeader !== false) || stickyHeader === true;

  const wrapperRef = useRef<HTMLDivElement>(null);
  // Too wide for the page, the table scrolls sideways in its own box. Not
  // with scrollX, already a scroll region.
  const [autoScroll, setAutoScroll] = useState(false);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const table = wrapper?.querySelector("table");
    if (!isListVariant || scrollX || !wrapper || !table) {
      setAutoScroll(false);
      return;
    }
    const check = () =>
      setAutoScroll(table.offsetWidth > wrapper.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(wrapper);
    observer.observe(table);
    return () => observer.disconnect();
  }, [isListVariant, scrollX]);

  // Flags each edge of a scroll box with columns hidden past it, for the edge
  // shadows. Written to the DOM directly, so scrolling doesn't re-render.
  const isScrollBox = !!scrollX || autoScroll;
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!isScrollBox || !wrapper) return;
    const update = () => {
      const hidden = wrapper.scrollWidth - wrapper.clientWidth;
      wrapper.toggleAttribute("data-more-start", wrapper.scrollLeft > 1);
      wrapper.toggleAttribute("data-more-end", hidden - wrapper.scrollLeft > 1);
      wrapper.style.setProperty(
        "--table-scroll-height",
        `${wrapper.clientHeight}px`,
      );
      wrapper.style.setProperty(
        "--table-box-height",
        `${wrapper.getBoundingClientRect().height}px`,
      );
    };
    update();
    wrapper.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    const table = wrapper.querySelector("table");
    if (table) observer.observe(table);
    return () => {
      wrapper.removeEventListener("scroll", update);
      observer.disconnect();
      wrapper.removeAttribute("data-more-start");
      wrapper.removeAttribute("data-more-end");
      wrapper.style.removeProperty("--table-scroll-height");
      wrapper.style.removeProperty("--table-box-height");
    };
  }, [isScrollBox]);

  // A sideways scroll box can't let its header stick to the window, so the
  // header is moved down the box as the page scrolls instead. CSS does that
  // with a scroll-driven animation (Table.module.scss); this is for browsers
  // without one.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!autoScroll || !useStickyHeader || !wrapper) return;
    if (CSS.supports("animation-timeline: view()")) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = wrapper.getBoundingClientRect();
      // Resolved from --table-sticky-top.
      const stickTop = parseFloat(getComputedStyle(wrapper).scrollMarginTop);
      // The header starts under the box's 1px border.
      const shift = Math.min(box.height, Math.max(0, stickTop - 1 - box.top));
      wrapper.style.setProperty("--table-header-shift", `${shift}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      wrapper.style.removeProperty("--table-header-shift");
    };
  }, [autoScroll, useStickyHeader]);

  useEffect(() => {
    if (!isListVariant || !useStickyHeader) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // In a scroll region the header is always stuck to the region's top, so
    // there is no unstuck state to detect. In a sideways scroll box
    // (autoScroll) the box keeps its corners while the header moves in it.
    if (autoScroll) {
      wrapper.removeAttribute("data-sticky-active");
      return;
    }
    if (scrollX) {
      wrapper.setAttribute("data-sticky-active", "true");
      return;
    }
    const header = wrapper.querySelector(".rt-TableHeader");
    if (!header) return;

    const check = () => {
      const top = (header as HTMLElement).getBoundingClientRect().top;
      // Where it sticks, resolved from --table-sticky-top.
      const topOffset = parseFloat(getComputedStyle(header).top);
      const isSticky = Math.abs(top - topOffset) < 2;
      if (isSticky) {
        wrapper.setAttribute("data-sticky-active", "true");
      } else {
        wrapper.removeAttribute("data-sticky-active");
      }
    };

    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [isListVariant, useStickyHeader, stickyTopOffset, scrollX, autoScroll]);

  const radixVariant = variant === "list" ? "surface" : variant;

  const tableElement = (
    <RadixTable.Root
      {...props}
      // The list wrapper carries the margins instead, outside its outline.
      {...(isListVariant ? {} : margins)}
      // The list wrapper carries the floor instead, where a drag-resize moves it.
      style={
        !isListVariant && minTableWidth
          ? ({
              ...props.style,
              "--table-min-width": `${minTableWidth}px`,
            } as React.CSSProperties)
          : props.style
      }
      variant={radixVariant}
      size={size !== undefined ? radixSize(size) : undefined}
      className={clsx(className, isListVariant && styles.tableList)}
    >
      {children}
    </RadixTable.Root>
  );

  if (!isListVariant) {
    return tableElement;
  }

  return (
    <Box
      {...margins}
      ref={wrapperRef}
      className={styles.wrapper}
      style={
        {
          ...(useStickyHeader && {
            "--table-sticky-top":
              stickyTopOffset !== undefined
                ? `${stickyTopOffset}px`
                : "var(--page-sticky-top, var(--page-top-offset))",
          }),
          ...(minTableWidth && { "--table-min-width": `${minTableWidth}px` }),
          ...(maxHeight !== undefined && {
            "--table-max-height":
              typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          }),
        } as React.CSSProperties
      }
      data-table-list
      data-sticky-header={useStickyHeader ? "true" : "false"}
      data-scroll-x={scrollX ? "true" : undefined}
      data-sticky-last-column={
        isScrollBox && stickyLastColumn ? "true" : undefined
      }
      data-auto-scroll={autoScroll ? "true" : undefined}
    >
      {tableElement}
    </Box>
  );
}

export function TableHeader({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Header>) {
  return <RadixTable.Header {...props}>{children}</RadixTable.Header>;
}

export function TableBody({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Body>) {
  return <RadixTable.Body {...props}>{children}</RadixTable.Body>;
}

export const TableRow = forwardRef<
  HTMLTableRowElement,
  React.ComponentProps<typeof RadixTable.Row>
>(function TableRow({ children, ...props }, ref) {
  return (
    <RadixTable.Row ref={ref} {...props}>
      {children}
    </RadixTable.Row>
  );
});

export function TableRowHeaderCell({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.RowHeaderCell>) {
  return (
    <RadixTable.RowHeaderCell {...props}>{children}</RadixTable.RowHeaderCell>
  );
}

export function TableColumnHeader({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.ColumnHeaderCell>) {
  return (
    <RadixTable.ColumnHeaderCell {...props}>
      {children}
    </RadixTable.ColumnHeaderCell>
  );
}

export function TableCell({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Cell>) {
  return <RadixTable.Cell {...props}>{children}</RadixTable.Cell>;
}
