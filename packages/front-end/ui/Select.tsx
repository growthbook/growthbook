import { Select as RadixSelect, Text, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactNode } from "react";
import clsx from "clsx";
import HelperText from "./HelperText";

type SelectProps = {
  label?: ReactNode;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
  errorLevel?: "error" | "warning";
  value: string | undefined;
  setValue: (value: string) => void;
  children: React.ReactNode;
  size?: "1" | "2" | "3";
  placeholder?: string;
  variant?: "classic" | "surface" | "soft" | "ghost";
  style?: React.CSSProperties;
  triggerClassName?: string;
  containerClassName?: string;
  className?: string;
} & MarginProps;

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  {
    label,
    defaultValue,
    disabled = false,
    error,
    errorLevel = "error",
    children,
    value,
    setValue,
    size = "3",
    placeholder,
    variant = "surface",
    triggerClassName,
    containerClassName,
    className,
    ...containerProps
  }: SelectProps,
  ref,
) {
  return (
    <Flex
      direction="column"
      {...containerProps}
      ref={ref}
      className={clsx(className, containerClassName)}
    >
      {typeof label === "string" ? (
        <Text as="label" size="3" weight="medium">
          {label}
        </Text>
      ) : label !== undefined ? (
        label
      ) : null}
      <RadixSelect.Root
        defaultValue={defaultValue}
        size={size}
        disabled={disabled}
        value={value}
        onValueChange={setValue}
      >
        <RadixSelect.Trigger
          placeholder={placeholder}
          className={clsx(triggerClassName, { error: error })}
          disabled={disabled}
          variant={variant}
        />
        <RadixSelect.Content variant="soft" position="popper">
          {children}
        </RadixSelect.Content>
      </RadixSelect.Root>
      {error && (
        <HelperText status={errorLevel} mt="1">
          {error}
        </HelperText>
      )}
    </Flex>
  );
});

export const SelectItem = forwardRef<
  HTMLDivElement,
  {
    value: string;
    children: string | string[] | ReactNode;
    disabled?: boolean;
  }
>(function SelectItem({ value, children, disabled = false, ...props }, ref) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      {...props}
      ref={ref}
      className="w-full"
    >
      {children}
    </RadixSelect.Item>
  );
});

export const SelectSeparator = forwardRef<HTMLDivElement>(
  function SelectSeparator(props, ref) {
    return <RadixSelect.Separator {...props} ref={ref} />;
  },
);
