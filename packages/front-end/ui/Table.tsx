import React from "react";
import { Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";

const DEFAULT_STICKY_TOP_OFFSET_PX = 55;

export type TableProps = Omit<
  React.ComponentProps<typeof RadixTable.Root>,
  "variant"
> & {
  /** "list" enables list-table wrapper, scroll, and styling; "surface" | "ghost" are passed to Radix */
  variant?: "list" | "surface" | "ghost";
  /** When true (or when variant="list"), header row is sticky with downward-only shadow */
  stickyHeader?: boolean;
  /** Top offset in px for sticky header (default 55). Used as CSS var --table-sticky-top. */
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

  const radixVariant = variant === "list" ? "surface" : variant;

  const tableElement = (
    <RadixTable.Root
      {...props}
      variant={radixVariant}
      className={clsx(className, isListVariant && "table-list")}
    >
      {children}
    </RadixTable.Root>
  );

  if (!isListVariant) {
    return tableElement;
  }

  return (
    <div
      className="table-list-wrapper appbox"
      style={
        {
          overflowX: "auto",
          "--table-sticky-top": `${stickyTopOffset}px`,
        } as React.CSSProperties
      }
      data-table-list
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

export function TableRow({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Row>) {
  return <RadixTable.Row {...props}>{children}</RadixTable.Row>;
}

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
