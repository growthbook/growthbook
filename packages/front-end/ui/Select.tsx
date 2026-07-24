import { Select as RadixSelect, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactNode } from "react";
import clsx from "clsx";
import HelperText from "./HelperText";
import Text, { TextSizes, TextWeights } from "./Text";

export type SelectSize = "x-small" | "small" | "legacy" | "medium";

function toRadixSize(size: SelectSize): "1" | "2" | "3" {
  switch (size) {
    case "x-small":
      return "1";
    case "small":
    case "legacy":
      return "2";
    case "medium":
      return "3";
  }
}

type SelectProps = {
  label?: ReactNode;
  labelSize?: TextSizes;
  labelWeight?: TextWeights;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
  errorLevel?: "error" | "warning";
  value: string | undefined;
  setValue: (value: string) => void;
  children: React.ReactNode;
  size?: SelectSize;
  placeholder?: string;
  variant?: "classic" | "surface" | "soft" | "ghost";
  style?: React.CSSProperties;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  /** Portal container — use to render the dropdown inside a parent portal (e.g. Popover). */
  container?: HTMLElement | null;
} & MarginProps;

export const Select = forwardRef<HTMLDivElement, SelectProps>(function Select(
  {
    label,
    labelSize,
    labelWeight = "semibold",
    defaultValue,
    disabled = false,
    error,
    errorLevel = "error",
    children,
    value,
    setValue,
    size = "small",
    placeholder,
    variant = "surface",
    triggerClassName,
    align = "start",
    container,
    ...containerProps
  }: SelectProps,
  ref,
) {
  return (
    <Flex
      direction="column"
      {...containerProps}
      ref={ref}
      className={`gb-select--${size}`}
    >
      {typeof label === "string" ? (
        <Text as="label" size={labelSize ?? "medium"} weight={labelWeight}>
          {label}
        </Text>
      ) : label !== undefined ? (
        label
      ) : null}
      <RadixSelect.Root
        defaultValue={defaultValue}
        size={toRadixSize(size)}
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
        <RadixSelect.Content
          variant="soft"
          position="popper"
          align={align}
          container={container ?? undefined}
        >
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

export const SelectGroup = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function SelectGroup({ children, ...props }, ref) {
    return (
      <RadixSelect.Group {...props} ref={ref}>
        {children}
      </RadixSelect.Group>
    );
  },
);

export const SelectLabel = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function SelectLabel({ children, ...props }, ref) {
    return (
      <RadixSelect.Label {...props} ref={ref}>
        {children}
      </RadixSelect.Label>
    );
  },
);
