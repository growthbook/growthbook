import { Button as RadixButton, ButtonProps, Text } from "@radix-ui/themes";
import { ReactNode, useState } from "react";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
import Link from "next/link";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import ConditionalWrapper from "@/components/ConditionalWrapper";

export type Color = "violet" | "red";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = "xs" | "sm" | "md" | "lg";

export type Props = {
  onClick?: (() => Promise<void>) | (() => void);
  href?: string;
  color?: Color;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  setError?: (error: string | null) => void;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  children: string | string[];
} & MarginProps &
  Pick<ButtonProps, "title" | "type" | "aria-label">;

export function getRadixSize(size: Size): Responsive<"1" | "2" | "3" | "4"> {
  switch (size) {
    case "xs":
      return "1";
    case "sm":
      return "2";
    case "md":
      return "3";
    case "lg":
      return "4";
  }
}

export default function Button({
  onClick,
  href,
  color = "violet",
  variant = "solid",
  size = "md",
  disabled,
  loading: _externalLoading,
  setError,
  icon,
  iconPosition = "left",
  children,
  ...otherProps
}: Props) {
  const [_internalLoading, setLoading] = useState(false);
  const loading = _externalLoading || _internalLoading;

  return (
    <ConditionalWrapper
      condition={!!href}
      wrapper={<Link href={href ?? "#"} />}
    >
      <RadixButton
        {...otherProps}
        onClick={
          onClick
            ? async (e) => {
                e.preventDefault();
                if (loading) return;
                setLoading(true);
                setError?.(null);
                try {
                  await onClick();
                } catch (error) {
                  setError?.(error.message);
                }
                setLoading(false);
              }
            : undefined
        }
        color={color}
        variant={variant}
        size={getRadixSize(size)}
        disabled={disabled}
        loading={loading}
      >
        {icon && iconPosition === "left" ? icon : null}
        <Text weight="medium">{children}</Text>
        {icon && iconPosition === "right" ? icon : null}
      </RadixButton>
    </ConditionalWrapper>
  );
}
