import { Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./Table.module.scss";

interface TableProps extends React.ComponentProps<typeof RadixTable.Root> {
  variant?: "standard" | "compact" | "bordered" | "query";
  hover?: boolean;
  stickyHeader?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export default function Table({
  children,
  variant = "standard",
  hover = false,
  stickyHeader = false,
  size = "md",
  className,
  ...props
}: TableProps) {
  return (
    <RadixTable.Root
      className={clsx(
        styles.table,
        variant === "standard" && styles.standard,
        variant === "compact" && styles.compact,
        variant === "bordered" && styles.bordered,
        variant === "query" && styles.query,
        hover && styles.hover,
        stickyHeader && styles.stickyHeader,
        size === "sm" && styles.small,
        className
      )}
      {...props}
    >
      {children}
    </RadixTable.Root>
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
