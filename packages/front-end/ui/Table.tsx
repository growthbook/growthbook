import React, { forwardRef, useEffect, useRef } from "react";
import { Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./Table.module.scss";

/** Standard top offset (px) for sticky table headers. Must be >= top nav height (56px) so the header's top border isn't covered. */
export const DEFAULT_STICKY_TOP_OFFSET_PX = 56;

export type TableProps = Omit<
  React.ComponentProps<typeof RadixTable.Root>,
  "variant"
> & {
  /** "list" enables list-table wrapper, scroll, and styling; "surface" | "ghost" are passed to Radix */
  variant?: "list" | "surface" | "ghost";
  /** When true (or when variant="list"), header row is sticky; when false, list variant keeps styling but header does not stick */
  stickyHeader?: boolean;
  /** Top offset in px for sticky header (default DEFAULT_STICKY_TOP_OFFSET_PX). Used as CSS var --table-sticky-top. */
  stickyTopOffset?: number;
  /** When true (or when variant="list"), first header row gets rounded top corners */
  roundedCorners?: boolean;
};

export default function Table({
  children,
  variant,
  stickyHeader,
  stickyTopOffset = DEFAULT_STICKY_TOP_OFFSET_PX,
  roundedCorners,
  className,
  ...props
}: TableProps) {
  const isListVariant =
    variant === "list" || stickyHeader === true || roundedCorners === true;
  const useStickyHeader =
    (variant === "list" && stickyHeader !== false) || stickyHeader === true;

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isListVariant || !useStickyHeader) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
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
  }, [isListVariant, useStickyHeader, stickyTopOffset]);

  const radixVariant = variant === "list" ? "surface" : variant;

  const tableElement = (
    <RadixTable.Root
      {...props}
      variant={radixVariant}
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
        useStickyHeader
          ? ({
              "--table-sticky-top": `${stickyTopOffset}px`,
            } as React.CSSProperties)
          : undefined
      }
      data-table-list
      data-sticky-header={useStickyHeader ? "true" : "false"}
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
