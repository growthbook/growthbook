import { Button as RadixButton, ButtonProps, Text } from "@radix-ui/themes";
import {
  CSSProperties,
  ForwardedRef,
  forwardRef,
  ReactNode,
  useState,
} from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { radixSize, Size as SharedSize } from "@/ui/sizes";

// "inherit" drops the forced accent color so the button inherits the
// surrounding Radix accent context (e.g. a Callout's status color).
export type Color = "violet" | "red" | "gray" | "inherit";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = SharedSize<"sm" | "md" | "lg" | "xl">;

export type Props = {
  onClick?:
    | ((e?: React.MouseEvent<HTMLButtonElement>) => Promise<void>)
    | (() => void);
  color?: Color;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  setError?: (error: string | null) => void;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  stopPropagation?: boolean;
  preventDefault?: boolean;
  children: string | string[] | ReactNode;
  style?: CSSProperties;
  tabIndex?: number;
} & MarginProps &
  Pick<
    ButtonProps,
    "aria-label" | "aria-disabled" | "aria-pressed" | "className"
  >;

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
      stopPropagation,
      preventDefault = true,
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
                if (preventDefault) e.preventDefault();
                if (stopPropagation) e.stopPropagation();
                if (loading) return;
                setLoading(true);
                setError?.(null);
                try {
                  await onClick(e);
                } catch (error) {
                  setError?.(error.message);
                }
                setLoading(false);
              }
            : undefined
        }
        color={color === "inherit" ? undefined : color}
        variant={variant}
        size={radixSize(size)}
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

type WhiteButtonProps = Omit<Props, "color"> & {
  fullWidth?: boolean;
};
export const WhiteButton = forwardRef<HTMLButtonElement, WhiteButtonProps>(
  function WhiteButton(
    {
      onClick,
      variant = "solid",
      size = "md",
      disabled,
      loading: _externalLoading,
      setError,
      icon,
      iconPosition = "left",
      type = "button",
      children,
      tabIndex,
      fullWidth = true,
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
        size={radixSize(size)}
        disabled={disabled}
        loading={loading}
        type={type}
        style={{
          width: fullWidth ? "100%" : undefined,
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
