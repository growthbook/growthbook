// radix dropdown wrapper
import {
  DropdownMenu as RadixDropdownMenu,
  Button,
  Text,
} from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";

type AllowedChildren = string | React.ReactNode;

type DropdownProps = {
  trigger: React.ReactNode;
  children: AllowedChildren;
} & MarginProps;

export function Dropdown({ trigger, children, ...props }: DropdownProps) {
  let triggerComponent = (
    <RadixDropdownMenu.Trigger>{trigger}</RadixDropdownMenu.Trigger>
  );

  if (typeof trigger === "string") {
    triggerComponent = (
      <RadixDropdownMenu.Trigger>
        <Button {...props}>{trigger}</Button>
      </RadixDropdownMenu.Trigger>
    );
  }
  return (
    <RadixDropdownMenu.Root {...props}>
      {triggerComponent}
      <RadixDropdownMenu.Content variant="soft">
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Root>
  );
}

type DropdownContentProps = {
  children: AllowedChildren;
  trigger: AllowedChildren;
} & MarginProps;

export function DropdownSubMenu({
  children,
  trigger,
  ...props
}: DropdownContentProps) {
  return (
    <RadixDropdownMenu.Sub>
      <RadixDropdownMenu.SubTrigger>{trigger}</RadixDropdownMenu.SubTrigger>
      <RadixDropdownMenu.SubContent {...props}>
        {children}
      </RadixDropdownMenu.SubContent>
    </RadixDropdownMenu.Sub>
  );
}

type DropdownItemProps = {
  children: AllowedChildren;
  disabled?: boolean;
  onClick?: () => void;
  color?: "red" | "default";
  shortcut?: RadixDropdownMenu.ItemProps["shortcut"];
} & MarginProps;

export function DropdownMenuItem({
  children,
  disabled = false,
  shortcut,
  color,
  onClick,
  ...props
}: DropdownItemProps) {
  if (color === "default") {
    color = undefined;
  }
  return (
    <RadixDropdownMenu.Item
      disabled={disabled}
      onSelect={onClick}
      color={color}
      shortcut={shortcut}
      {...props}
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}

type DropdownMenuLabelProps = {
  children: AllowedChildren;
} & MarginProps;

export function DropdownMenuLabel({
  children,
  ...props
}: DropdownMenuLabelProps): JSX.Element {
  return (
    <RadixDropdownMenu.Label {...props}>
      <Text color="gray">{children}</Text>
    </RadixDropdownMenu.Label>
  );
}

export function DropdownMenuSeparator() {
  return <RadixDropdownMenu.Separator />;
}
