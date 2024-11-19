import { Button as RadixButton, ButtonProps, Text } from "@radix-ui/themes";
import { ForwardedRef, forwardRef, ReactNode, useState } from "react";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";

export type Color = "violet" | "red";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = "xs" | "sm" | "md" | "lg";

export type Props = {
  onClick?: (() => Promise<void>) | (() => void);
  color?: Color;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  setError?: (error: string | null) => void;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  children: string | string[];
  style?: React.CSSProperties;
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

const Button = forwardRef<HTMLButtonElement, Props>(
  (
    {
      onClick,
      color = "violet",
      variant = "solid",
      size = "md",
      disabled,
      loading: _externalLoading,
      setError,
      icon,
      iconPosition = "left",
      type = "button",
      children,
      ...otherProps
    },
    ref: ForwardedRef<HTMLButtonElement>
  ) => {
    const [_internalLoading, setLoading] = useState(false);
    const loading = _externalLoading || _internalLoading;

    return (
      <RadixButton
        ref={ref}
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
        type={type}
      >
        {icon && iconPosition === "left" ? icon : null}
        <Text weight="medium">{children}</Text>
        {icon && iconPosition === "right" ? icon : null}
      </RadixButton>
    );
  }
);
Button.displayName = "Button";
export default Button;
