import React, { forwardRef, useEffect, useRef, useState } from "react";
import { Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";
import styles from "./Table.module.scss";

/** Standard top offset (px) for sticky table headers. Must be >= top nav height (44px) so the header's top border isn't covered. */
export const DEFAULT_STICKY_TOP_OFFSET_PX = 44;

export type TableProps = Omit<
  React.ComponentProps<typeof RadixTable.Root>,
  "variant" | "size"
> & {
  /** "list" enables list-table wrapper, scroll, and styling; "surface" | "ghost" are passed to Radix */
  variant?: "list" | "surface" | "ghost";
  size?: Size<"sm" | "md" | "lg">;
  /** When true (or when variant="list"), header row is sticky; when false, list variant keeps styling but header does not stick */
  stickyHeader?: boolean;
  /** Top offset in px for sticky header (default DEFAULT_STICKY_TOP_OFFSET_PX). Used as CSS var --table-sticky-top. */
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
  /** Pins the last column to the right edge while the rest scrolls under it. */
  stickyLastColumn?: boolean;
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
  stickyTopOffset = DEFAULT_STICKY_TOP_OFFSET_PX,
  roundedCorners,
  scrollX,
  stickyLastColumn,
  minTableWidth,
  className,
  ...props
}: TableProps) {
  const isListVariant =
    variant === "list" || stickyHeader === true || roundedCorners === true;
  const useStickyHeader =
    (variant === "list" && stickyHeader !== false) || stickyHeader === true;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [overflowX, setOverflowX] = useState(false);

  // PROTOTYPE (set in review; with the docked GrowthBot rail, pages got
  // narrower): a list table wider than its space scrolls sideways in its
  // own box instead of running past the page, under the rail. Only then,
  // as the experiments list does (ExperimentsListTable's scrollOnOverflow):
  // a scroll box can't let the header stick to the window as the page
  // scrolls, so while it fits the header sticks as before. Not with scrollX
  // (already a scroll region). The experiments list, which does this
  // itself, is left alone (Table.module.scss).
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

  // A pinned column only earns its divider once there is something behind it.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!scrollX || !stickyLastColumn || !wrapper) return;
    const check = () =>
      setOverflowX(wrapper.scrollWidth > wrapper.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(wrapper);
    // The table too: a drag-resize changes its width without changing the
    // wrapper's.
    const table = wrapper.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [scrollX, stickyLastColumn]);

  useEffect(() => {
    if (!isListVariant || !useStickyHeader) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // In a scroll region the header is always stuck to the region's top, so
    // there is no unstuck state to detect. Scrolling sideways on its own
    // (autoScroll), it doesn't stick at all.
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
      const isSticky = Math.abs(top - stickyTopOffset) < 2;
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
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      style={
        {
          ...(useStickyHeader && {
            "--table-sticky-top": `${stickyTopOffset}px`,
          }),
          ...(minTableWidth && { "--table-min-width": `${minTableWidth}px` }),
        } as React.CSSProperties
      }
      data-table-list
      data-sticky-header={useStickyHeader ? "true" : "false"}
      data-scroll-x={scrollX ? "true" : undefined}
      data-sticky-last-column={scrollX && stickyLastColumn ? "true" : undefined}
      data-overflow-x={overflowX ? "true" : undefined}
      data-auto-scroll={autoScroll ? "true" : undefined}
    >
      {tableElement}
    </div>
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
