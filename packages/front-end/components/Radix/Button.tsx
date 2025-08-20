import { Button as RadixButton, ButtonProps, Text } from "@radix-ui/themes";
import {
  CSSProperties,
  ForwardedRef,
  forwardRef,
  ReactNode,
  useState,
} from "react";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";

export type Color = "violet" | "red" | "gray";
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
  stopPropagation?: boolean;
  children: string | string[] | ReactNode;
  style?: CSSProperties;
  tabIndex?: number;
} & MarginProps &
  Pick<ButtonProps, "title" | "type" | "aria-label" | "className">;

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
      size = "sm",
      disabled,
      loading: _externalLoading,
      setError,
      icon,
      iconPosition = "left",
      stopPropagation,
      type = "button",
      children,
      ...otherProps
    },
    ref: ForwardedRef<HTMLButtonElement>,
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
                if (stopPropagation) e.stopPropagation();
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
  },
);
Button.displayName = "Button";
export default Button;

type WhiteButtonProps = Omit<Props, "color">;
export const WhiteButton = forwardRef<HTMLButtonElement, WhiteButtonProps>(
  function WhiteButton(
    {
      onClick,
      variant = "solid",
      size = "sm",
      disabled,
      loading: _externalLoading,
      setError,
      icon,
      iconPosition = "left",
      type = "button",
      children,
      tabIndex,
      ...otherProps
    }: WhiteButtonProps,
    ref: ForwardedRef<HTMLButtonElement>,
  ) {
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
        variant={variant}
        size={getRadixSize(size)}
        disabled={disabled}
        loading={loading}
        type={type}
        style={{
          width: "100%",
          backgroundColor: variant === "outline" ? "" : "var(--white-a12)",
          color:
            variant === "outline" ? "var(--white-a12)" : "var(--black-a12)",
          boxShadow:
            variant === "outline" ? "inset 0 0 0 1px var(--white-a8)" : "",
        }}
        tabIndex={tabIndex}
      >
        {icon && iconPosition === "left" ? icon : null}
        <Text weight="medium">{children}</Text>
        {icon && iconPosition === "right" ? icon : null}
      </RadixButton>
    );
  },
);
