// radix dropdown wrapper
import { DropdownMenu as RadixDropdownMenu } from "@radix-ui/themes";
// import colors from radix-ui themes
import type { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
type AllowedChildren = React.ReactNode;

type Props = {
  trigger: React.ReactNode;
  disabled?: boolean;
  errorLevel?: "error" | "warning";
  description?: string;
  children: AllowedChildren;
} & MarginProps;
export function Dropdown({ trigger, children, ...containerProps }: Props) {
  return (
    <RadixDropdownMenu.Root {...containerProps}>
      <RadixDropdownMenu.Trigger>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Content>{children}</RadixDropdownMenu.Content>
    </RadixDropdownMenu.Root>
  );
}

type DropdownContentProps = {
  children: AllowedChildren;
  trigger: string | React.ReactNode;
};
export function DropdownSubMenu({
  children,
  trigger,
  ...props
}: DropdownContentProps & MarginProps) {
  return (
    <RadixDropdownMenu.Sub {...props}>
      <RadixDropdownMenu.SubTrigger>{trigger}</RadixDropdownMenu.SubTrigger>
      <RadixDropdownMenu.SubContent>{children}</RadixDropdownMenu.SubContent>
    </RadixDropdownMenu.Sub>
  );
}
type DropdownItemProps = {
  children: AllowedChildren;
  disabled?: boolean;
  onClick?: () => void;
  color?: "red" | "default";
  shortcut?: RadixDropdownMenu.ItemProps["shortcut"];
};

export function DropdownMenuItem({
  children,
  disabled = false,
  shortcut,
  color,
  onClick,
}: DropdownItemProps & MarginProps) {
  if (color === "default") {
    color = undefined;
  }
  return (
    <RadixDropdownMenu.Item
      disabled={disabled}
      onSelect={onClick}
      color={color}
      shortcut={shortcut}
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}
export function DropdownMenuLabel({
  children,
}: {
  children: AllowedChildren;
}): JSX.Element {
  return <RadixDropdownMenu.Label>{children}</RadixDropdownMenu.Label>;
}

export function DropdownMenuSeparator() {
  return <RadixDropdownMenu.Separator />;
}
