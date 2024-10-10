// radix dropdown wrapper
import { DropdownMenu as RadixDropdownMenu, Button } from "@radix-ui/themes";
// import colors from radix-ui themes
import type { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
type AllowedChildren = React.ReactElement<
  | typeof DropdownSubMenu
  | typeof DropdownMenuItem
  | typeof DropdownSeparator
  | React.ReactNode
>;

type Props = {
  label: string;
  disabled?: boolean;
  errorLevel?: "error" | "warning";
  description?: string;
  children: AllowedChildren[] | AllowedChildren;
  variant?: "primary" | "secondary";
} & MarginProps;
export function Dropdown({
  label,
  children,
  variant,
  ...containerProps
}: Props) {
  const variantRadix = variant === "primary" ? "soft" : "outline";
  return (
    <RadixDropdownMenu.Root {...containerProps}>
      <RadixDropdownMenu.Trigger>
        <Button variant={variantRadix} size="1">
          {label}
          <RadixDropdownMenu.TriggerIcon />
        </Button>
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Content>{children}</RadixDropdownMenu.Content>
    </RadixDropdownMenu.Root>
  );
}

type DropdownContentProps = {
  children: AllowedChildren[] | AllowedChildren;
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
  children: React.ReactNode;
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

export function DropdownSeparator() {
  return <RadixDropdownMenu.Separator />;
}

type DropdownGroupProps = {
  title?: string;
  children: AllowedChildren[] | AllowedChildren;
};
//if light mode gray-1 else gray-9 for dark mode
const backgroundColor = "var(--gray-1)";
export function DropdownGroup({ children }: DropdownGroupProps) {
  return (
    <div
      style={{
        borderRadius: "var(--border-radius4)",
        padding: "var(--space2)",
        backgroundColor: backgroundColor,
        marginBottom: "5px",
      }}
    >
      {children}
    </div>
  );
}
export function DropdownCompnentItem() {
  return <RadixDropdownMenu.Item>{children}</RadixDropdownMenu.Item>;
}
