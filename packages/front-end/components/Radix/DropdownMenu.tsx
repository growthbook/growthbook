import { DropdownMenu as RadixDropdownMenu, Text } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { PiCaretDown } from "react-icons/pi";
import React from "react";
import Button from "@/components/Radix/Button";

type AllowedChildren = string | React.ReactNode;

type DropdownProps = {
  trigger: React.ReactNode;
  menuPlacement?: "start" | "center" | "end";
  menuWidth?: "full" | number;
  children: AllowedChildren;
} & MarginProps;

export function DropdownMenu({
  trigger,
  menuPlacement = "start",
  menuWidth,
  children,
  ...props
}: DropdownProps) {
  const triggerComponent =
    typeof trigger === "string" ? (
      <Button icon={<PiCaretDown />} iconPosition="right">
        {trigger}
      </Button>
    ) : (
      trigger
    );

  return (
    <RadixDropdownMenu.Root {...props}>
      <RadixDropdownMenu.Trigger>{triggerComponent}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Content
        align={menuPlacement}
        variant="soft"
        side="bottom"
        className={
          menuWidth === "full" ? "dropdown-content-width-full" : undefined
        }
        style={{ width: typeof menuWidth === "number" ? menuWidth : undefined }}
      >
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
