import { Table as RadixTable } from "@radix-ui/themes";

export default function Table({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Root>) {
  return <RadixTable.Root {...props}>{children}</RadixTable.Root>;
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
